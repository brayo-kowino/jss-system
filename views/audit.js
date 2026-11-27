import { fetchRecentLogs, fetchLogsSince, describeLog } from "../js/services/audit.service.js";
import { listSchoolUsers } from "../js/services/auth.service.js";
import { el, icon, toDate } from "../js/utils.js";
import { recordEmpty, recordField } from "../js/components/records-workspace.js";

const HOUR = 60 * 60 * 1000;
const DEFAULT_RANGE = "1h";
const RANGE_OPTIONS = {
  "1h": { label: "Last hour", ms: HOUR },
  "12h": { label: "Last 12 hours", ms: 12 * HOUR },
  "24h": { label: "Last 24 hours", ms: 24 * HOUR },
  "7d": { label: "Last 7 days", ms: 7 * 24 * HOUR },
  "30d": { label: "Last 30 days", ms: 30 * 24 * HOUR },
  all: { label: "Latest 1,000 entries", ms: null },
};

function loadLogs(range) {
  const { ms } = RANGE_OPTIONS[range];
  return ms === null ? fetchRecentLogs(1000) : fetchLogsSince(Date.now() - ms);
}

function readable(value) {
  return (value || "").replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

function moduleName(entity) {
  return entity === "auth" ? "Sign-in & access" : readable(entity);
}

function formatDateTime(timestamp) {
  const date = toDate(timestamp);
  return date?.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) || "Date unavailable";
}

function updateOptions(select, values, emptyLabel, labelFor) {
  const selected = select.value;
  const options = [...new Set([...values, selected].filter(Boolean))].sort((a, b) => labelFor(a).localeCompare(labelFor(b)));
  select.replaceChildren(el("option", { value: "" }, emptyLabel), ...options.map((value) => el("option", { value }, labelFor(value))));
  select.value = selected;
}

function stat(label) {
  const value = el("dd");
  return { value, item: el("div", {}, [el("dt", {}, label), value]) };
}

export async function render() {
  let logs = [];
  let usersById = new Map();
  let matching = [];
  let requestVersion = 0;
  let state = "loading";

  const workspace = el("div", { class: "records-workspace records-workspace--audit" });
  const search = el("input", { id: "f-search", type: "search", placeholder: "Search activity or record ID" });
  const moduleSelect = el("select", { id: "f-entity" });
  const action = el("select", { id: "f-action" });
  const user = el("select", { id: "f-user" });
  const advanced = el("div", { id: "audit-advanced-filters", class: "audit-advanced-filters" }, [
    recordField("Module", moduleSelect), recordField("Action", action), recordField("User", user),
  ]);
  const filterLabel = el("span", {}, "More filters");
  const toggleFilters = el("button", {
    type: "button", class: "btn btn--ghost btn--sm audit-filters-toggle", "aria-controls": advanced.id, "aria-expanded": "false",
    onClick: () => toggleFilters.setAttribute("aria-expanded", String(advanced.classList.toggle("audit-advanced-filters--open"))),
  }, [icon("filter_list"), filterLabel]);
  const range = el("select", { id: "f-range" }, Object.entries(RANGE_OPTIONS).map(([value, option]) => el("option", { value }, option.label)));
  const result = el("p", { class: "records-muted", role: "status" });
  const table = el("div", { class: "records-list" });
  const actionsStat = stat("Actions logged");
  const usersStat = stat("Users with activity");
  const moduleStat = stat("Most active module");
  const clear = el("button", { type: "button", id: "clear-filters", class: "btn btn--ghost btn--sm", onClick: clearFilters }, [icon("filter_alt_off"), "Reset filters"]);
  const exportButton = el("button", { type: "button", id: "export-csv", class: "btn btn--ghost btn--sm", onClick: () => exportCsv(matching, userName, usersById) }, [icon("download"), "Export CSV"]);

  function userName(id) {
    const entry = usersById.get(id);
    return entry?.fullName || entry?.email || (id && id !== "unknown" ? id : "Unknown user");
  }

  function syncChoices() {
    updateOptions(moduleSelect, logs.map((log) => log.entity), "All modules", moduleName);
    updateOptions(action, logs.map((log) => log.action), "All actions", readable);
    updateOptions(user, logs.map((log) => log.userId), "All users", userName);
  }

  function refreshSummary() {
    const counts = new Map();
    let busiest;
    for (const { entity } of logs) {
      if (!entity) continue;
      counts.set(entity, (counts.get(entity) || 0) + 1);
      if (!busiest || counts.get(entity) > counts.get(busiest)) busiest = entity;
    }
    actionsStat.value.textContent = state === "ready" ? String(logs.length) : "—";
    const userCount = new Set(logs.map((log) => log.userId).filter((id) => id && id !== "unknown")).size;
    usersStat.value.textContent = state === "ready" ? String(userCount) : "—";
    moduleStat.value.textContent = state === "ready" && busiest ? moduleName(busiest) : "—";
  }

  function refreshList() {
    const query = search.value.trim().toLowerCase();
    const activeFilters = [moduleSelect, action, user].filter((control) => control.value).length;
    const hasFilters = !!(query || activeFilters);
    clear.hidden = !hasFilters && range.value === DEFAULT_RANGE;
    filterLabel.textContent = activeFilters ? `More filters (${activeFilters})` : "More filters";
    matching = state === "ready" ? logs.filter((log) => {
      if (moduleSelect.value && log.entity !== moduleSelect.value) return false;
      if (action.value && log.action !== action.value) return false;
      if (user.value && log.userId !== user.value) return false;
      if (!query) return true;
      return [describeLog(log).label, log.entity, moduleName(log.entity), log.entityId, userName(log.userId)]
        .filter(Boolean).join(" ").toLowerCase().includes(query);
    }) : [];
    exportButton.disabled = !matching.length;
    result.textContent = state === "ready" && logs.length
      ? (hasFilters ? `${matching.length} of ${logs.length} entries` : `${logs.length} ${logs.length === 1 ? "entry" : "entries"}`)
      : "";

    if (state === "loading") {
      table.replaceChildren(el("p", { class: "records-pending", role: "status" }, "Loading activity…"));
    } else if (state === "error") {
      table.replaceChildren(recordEmpty("error_outline", "Activity couldn’t load", "Try loading the selected time range again.",
        el("button", { type: "button", class: "btn btn--ghost btn--sm", onClick: reload }, "Retry")));
    } else if (!logs.length) {
      table.replaceChildren(recordEmpty("history", "No activity in this range", "Choose a wider time range to see earlier activity."));
    } else if (!matching.length) {
      table.replaceChildren(recordEmpty("search_off", "No matching activity", "Adjust the search or filters to find more entries."));
    } else {
      table.replaceChildren(renderActivity(matching, userName, usersById));
    }
  }

  function clearFilters() {
    const rangeChanged = range.value !== DEFAULT_RANGE;
    search.value = moduleSelect.value = action.value = user.value = "";
    range.value = DEFAULT_RANGE;
    search.focus();
    if (rangeChanged) reload();
    else refreshList();
  }

  async function reload() {
    const request = ++requestVersion;
    const requestedRange = range.value;
    state = "loading";
    refreshSummary();
    refreshList();
    try {
      const nextLogs = await loadLogs(requestedRange);
      if (request !== requestVersion) return;
      logs = nextLogs;
      state = "ready";
    } catch (error) {
      if (request !== requestVersion) return;
      console.error("Could not load audit activity", error);
      logs = [];
      state = "error";
    }
    syncChoices();
    refreshSummary();
    refreshList();
  }

  syncChoices();
  search.addEventListener("input", refreshList);
  [moduleSelect, action, user].forEach((control) => control.addEventListener("change", refreshList));
  range.addEventListener("change", reload);
  workspace.append(
    el("section", { class: "records-card", "aria-labelledby": "audit-summary" }, [
      el("div", { class: "records-toolbar records-card-head" }, [
        el("h2", { id: "audit-summary" }, "Activity overview"),
        el("div", { class: "records-actions" }, [recordField("Time range", range), exportButton]),
      ]),
      el("dl", { class: "records-stats" }, [actionsStat.item, usersStat.item, moduleStat.item]),
    ]),
    el("section", { class: "records-card", "aria-labelledby": "audit-log" }, [
      el("div", { class: "records-toolbar records-card-head" }, [el("h2", { id: "audit-log" }, "Activity log"), clear]),
      el("div", { class: "records-controls records-controls--audit" }, [
        recordField("Search activity", search), toggleFilters, advanced,
      ]),
      el("div", { class: "records-result" }, result),
      table,
    ]),
  );
  await Promise.all([
    reload(),
    listSchoolUsers().then((users) => { usersById = new Map(users.map((entry) => [entry.uid, entry])); }).catch(() => {}),
  ]);
  syncChoices();
  refreshList();
  return workspace;
}

function renderActivity(logs, userName, usersById) {
  return el("table", { class: "records-table records-table--audit", "aria-labelledby": "audit-log" }, [
    el("thead", {}, el("tr", {}, ["Action", "User", "When", "Module", "Record"].map((heading) => el("th", { scope: "col" }, heading)))),
    el("tbody", {}, logs.map((log) => {
      const { icon: symbol, color, label } = describeLog(log);
      const role = readable(usersById.get(log.userId)?.role);
      return el("tr", {}, [
        el("td", { "data-label": "Action", class: "records-table-lead" }, el("div", { class: "records-identity" }, [icon(symbol, `text-${color}`, { "aria-hidden": "true" }), el("strong", {}, label)])),
        el("td", { "data-label": "User" }, el("div", {}, [el("strong", {}, userName(log.userId)), role ? el("div", { class: "records-muted" }, role) : null])),
        el("td", { "data-label": "When" }, formatDateTime(log.timestamp)),
        el("td", { "data-label": "Module" }, log.entity ? el("span", { class: "records-tag" }, moduleName(log.entity)) : "—"),
        el("td", { "data-label": "Record" }, log.entityId ? el("code", { class: "records-record-id" }, log.entityId) : "—"),
      ]);
    })),
  ]);
}

function exportCsv(logs, userName, usersById) {
  const header = ["When", "User", "Role", "Action", "Module", "Record ID"];
  const rows = logs.map((log) => [
    formatDateTime(log.timestamp), userName(log.userId), readable(usersById.get(log.userId)?.role),
    describeLog(log).label, log.entity || "", log.entityId || "",
  ]);
  const csv = [header, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  el("a", { href: url, download: "audit-trail.csv" }).click();
  URL.revokeObjectURL(url);
}
