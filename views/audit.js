import { fetchRecentLogs, describeLog } from "../js/services/audit.service.js";
import { listSchoolUsers } from "../js/services/auth.service.js";
import { el, icon, toast } from "../js/utils.js";

// Firestore stores appreciably more logs than anyone needs to scroll
// through - this is the ceiling we pull back and then filter/sort
// client-side, same pattern the rest of the app uses for its list views.
const FETCH_LIMIT = 1000;

let logs = [];
let usersById = new Map();

let filters = { search: "", entity: "all", action: "all", user: "all", range: "all" };

const RANGE_LABELS = {
  all: "All time",
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
};

export async function render({ profile }) {
  const [rawLogs, users] = await Promise.all([fetchRecentLogs(FETCH_LIMIT), listSchoolUsers().catch(() => [])]);
  logs = rawLogs;
  usersById = new Map(users.map((u) => [u.uid, u]));

  const wrap = el("div", {});

  wrap.append(
    el("div", { class: "page-header" }, [
      el("div", {}, [el("h1", {}, ""), el("p", {}, summaryLine())]),
    ])
  );

  const kpiMount = el("div", {});
  wrap.append(kpiMount);
  renderKpis(kpiMount);

  const filterMount = el("div", { class: "card", style: "margin-bottom:16px;" });
  wrap.append(filterMount);
  renderFilters(filterMount, profile);

  const tableWrap = el("div", { class: "table-wrap" });
  wrap.append(tableWrap);
  renderTable(tableWrap);

  return wrap;
}

export function init() {}

// ------------------------------------------------------------- helpers --

function summaryLine() {
  if (!logs.length) return "No actions have been logged yet.";
  const distinctUsers = new Set(logs.map((l) => l.userId)).size;
  return `${logs.length} action(s) logged across ${distinctUsers} user(s).`;
}

function userLabel(userId) {
  const u = usersById.get(userId);
  if (u) return u.fullName || u.email || userId;
  if (userId === "unknown" || !userId) return "Unknown user";
  return userId;
}

function roleLabel(role) {
  if (!role) return "";
  return role.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function withinRange(log, range) {
  if (range === "all") return true;
  const seconds = log.timestamp?.seconds;
  if (!seconds) return false;
  const ms = seconds * 1000;
  const now = Date.now();
  if (range === "today") {
    const d = new Date(ms);
    const n = new Date();
    return d.toDateString() === n.toDateString();
  }
  if (range === "7d") return now - ms <= 7 * 24 * 60 * 60 * 1000;
  if (range === "30d") return now - ms <= 30 * 24 * 60 * 60 * 1000;
  return true;
}

function getFiltered() {
  const q = filters.search.trim().toLowerCase();
  return logs
    .filter((l) => filters.entity === "all" || l.entity === filters.entity)
    .filter((l) => filters.action === "all" || l.action === filters.action)
    .filter((l) => filters.user === "all" || l.userId === filters.user)
    .filter((l) => withinRange(l, filters.range))
    .filter((l) => {
      if (!q) return true;
      const { label } = describeLog(l);
      const haystack = [label, l.entity, l.entityId, userLabel(l.userId)].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(q);
    });
}

function formatDateTime(timestamp) {
  if (!timestamp?.seconds) return "Just now";
  const d = new Date(timestamp.seconds * 1000);
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// --------------------------------------------------------------- KPIs --

function renderKpis(container) {
  container.innerHTML = "";

  const today = logs.filter((l) => withinRange(l, "today")).length;
  const week = logs.filter((l) => withinRange(l, "7d")).length;
  const distinctUsers = new Set(logs.map((l) => l.userId)).size;

  const entityCounts = new Map();
  for (const l of logs) entityCounts.set(l.entity, (entityCounts.get(l.entity) || 0) + 1);
  let busiest = null;
  for (const [entity, count] of entityCounts) {
    if (!busiest || count > busiest.count) busiest = { entity, count };
  }

  const kpis = [
    { label: "Actions Today", value: today, icon: "today", color: "blue" },
    { label: "Actions This Week", value: week, icon: "date_range", color: "gold" },
    { label: "Active Users", value: distinctUsers, icon: "group", color: "purple" },
    { label: "Busiest Module", value: busiest ? busiest.entity.replace(/_/g, " ") : "N/A", icon: "bolt", color: "green" },
  ];

  const grid = el(
    "div",
    { class: "md3-kpi-grid" },
    kpis.map((k) =>
      el("div", { class: `md3-kpi-chip md3-kpi-chip--${k.color}` }, [
        el("div", { class: "md3-kpi-chip__icon" }, [el("span", { class: "material-symbols-rounded" }, k.icon)]),
        el("div", {}, [
          el("div", { class: "md3-kpi-chip__label" }, k.label),
          el("div", { class: "md3-kpi-chip__value" }, String(k.value)),
        ]),
      ])
    )
  );
  container.append(grid);
}

// ------------------------------------------------------------ filters --

function selectField(label, id, options, current, labelFn) {
  return el("div", { class: "field" }, [
    el("label", {}, label),
    el(
      "select",
      { id },
      options.map((v) => el("option", { value: v, ...(v === current ? { selected: "true" } : {}) }, labelFn(v)))
    ),
  ]);
}

function renderFilters(container, profile) {
  container.innerHTML = "";
  const row = el("div", { class: "filter-toolbar" });

  const entities = ["all", ...new Set(logs.map((l) => l.entity).filter(Boolean))].sort();
  const actions = ["all", ...new Set(logs.map((l) => l.action).filter(Boolean))].sort();
  const users = ["all", ...new Set(logs.map((l) => l.userId).filter(Boolean))];

  row.append(
    el("div", { class: "field" }, [
      el("label", {}, "Search"),
      el("input", { id: "f-search", placeholder: "Search action, module, user…", value: filters.search }),
    ]),
    selectField("Module", "f-entity", entities, filters.entity, (v) => (v === "all" ? "All Modules" : v.replace(/_/g, " "))),
    selectField("Action", "f-action", actions, filters.action, (v) => (v === "all" ? "All Actions" : v.replace(/_/g, " "))),
    selectField("User", "f-user", users, filters.user, (v) => (v === "all" ? "All Users" : userLabel(v))),
    selectField("When", "f-range", Object.keys(RANGE_LABELS), filters.range, (v) => RANGE_LABELS[v])
  );

  const actionsRow = el("div", { class: "filter-actions" }, [
    el("button", { class: "btn btn--ghost btn--sm", id: "clear-filters" }, [icon("filter_alt_off"), "Clear filters"]),
    el("button", { class: "btn btn--ghost btn--sm", id: "export-csv" }, [
      el("span", { class: "material-symbols-rounded" }, "download"),
      " Export CSV",
    ]),
  ]);

  container.append(row, actionsRow);

  setTimeout(() => {
    document.getElementById("f-search")?.addEventListener("input", (e) => {
      filters.search = e.target.value;
      rerender(profile);
    });
    document.getElementById("f-entity")?.addEventListener("change", (e) => {
      filters.entity = e.target.value;
      rerender(profile);
    });
    document.getElementById("f-action")?.addEventListener("change", (e) => {
      filters.action = e.target.value;
      rerender(profile);
    });
    document.getElementById("f-user")?.addEventListener("change", (e) => {
      filters.user = e.target.value;
      rerender(profile);
    });
    document.getElementById("f-range")?.addEventListener("change", (e) => {
      filters.range = e.target.value;
      rerender(profile);
    });
    document.getElementById("clear-filters")?.addEventListener("click", () => {
      filters = { search: "", entity: "all", action: "all", user: "all", range: "all" };
      rerender(profile);
    });
    document.getElementById("export-csv")?.addEventListener("click", exportCsv);
  });
}

function rerender(profile) {
  const filterMount = document.querySelector(".card");
  const tableWrap = document.querySelector(".table-wrap");
  if (filterMount) renderFilters(filterMount, profile);
  if (tableWrap) renderTable(tableWrap);
}

function exportCsv() {
  const list = getFiltered();
  if (!list.length) {
    toast("Nothing to export for the current filters.", "info");
    return;
  }
  const header = ["When", "User", "Role", "Action", "Module", "Record ID"];
  const rows = list.map((l) => {
    const { label } = describeLog(l);
    const u = usersById.get(l.userId);
    return [formatDateTime(l.timestamp), userLabel(l.userId), roleLabel(u?.role), label, l.entity || "", l.entityId || ""];
  });
  const csv = [header, ...rows]
    .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "audit-trail.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// --------------------------------------------------------------- table --

function emptyState(title, message) {
  return el("div", { class: "empty-state" }, [
    el("span", { class: "material-symbols-rounded empty-state__icon" }, "policy"),
    el("h3", {}, title),
    el("p", {}, message),
  ]);
}

function renderTable(container) {
  container.innerHTML = "";

  if (!logs.length) {
    container.append(emptyState("No activity yet", "Actions taken across the system will show up here as they happen."));
    return;
  }

  const list = getFiltered();
  if (!list.length) {
    container.append(emptyState("No matches", "Try adjusting or clearing your filters."));
    return;
  }

  const table = el("table", {}, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "When"),
      el("th", {}, "User"),
      el("th", {}, "Action"),
      el("th", {}, "Module"),
      el("th", {}, "Record"),
    ])),
  ]);
  const tbody = el("tbody", {});

  for (const log of list) {
    const { icon: iconName, color, label } = describeLog(log);
    const u = usersById.get(log.userId);

    const userCell = el("td", {}, [
      el("div", { style: "font-weight:600; color:var(--color-primary-900); font-size:var(--fs-sm);" }, userLabel(log.userId)),
      u?.role ? el("div", { class: "text-xs text-muted" }, roleLabel(u.role)) : "",
    ]);

    const actionCell = el("td", {}, [
      el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
        el("span", { class: `material-symbols-rounded text-${color}`, style: "font-size:18px;" }, iconName),
        label,
      ]),
    ]);

    tbody.append(
      el("tr", {}, [
        el("td", {}, [
          el("div", { style: "font-size:var(--fs-sm);" }, formatDateTime(log.timestamp)),
        ]),
        userCell,
        actionCell,
        el("td", {}, log.entity ? el("span", { class: "badge badge--muted" }, log.entity.replace(/_/g, " ")) : "N/A"),
        el("td", {}, log.entityId ? el("span", { class: "text-xs text-muted", title: log.entityId }, log.entityId.length > 16 ? `${log.entityId.slice(0, 16)}…` : log.entityId) : el("span", { class: "text-muted" }, "—")),
      ])
    );
  }

  table.append(tbody);
  container.append(table);
}
