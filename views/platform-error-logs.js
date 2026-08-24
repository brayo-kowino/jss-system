import { listErrorLogs } from "../js/services/support.service.js";
import { el, icon, formatDate, busyButton, toast } from "../js/utils.js";
import { openModal } from "../js/components/modal.js";

let logs = [];

function renderRow(log) {
  const tr = el("tr", {});
  tr.append(
    el("td", { "data-label": "Code" }, el("strong", { style: "font-family: monospace;" }, log.code)),
    el("td", { "data-label": "Error & Path" }, [
      el("strong", {}, log.kind || "generic"),
      el("div", { class: "text-sm text-muted", style: "margin-top: 4px; max-width: 300px; white-space: normal;" }, log.message),
      el("div", { class: "text-xs text-muted", style: "margin-top: 4px;" }, `Path: ${log.path || "/"}`)
    ]),
    el("td", { "data-label": "School/User" }, [
      el("div", { class: "text-sm" }, `School: ${log.schoolId || "N/A"}`),
      el("div", { class: "text-xs text-muted" }, `User: ${log.userId || "N/A"}`)
    ]),
    el("td", { "data-label": "Time" }, formatDate(log.createdAt?.seconds * 1000) || "Unknown"),
    el("td", { "data-label": "Actions", class: "row-actions" }, [
      el("button", {
        class: "btn btn--ghost btn--sm",
        onClick: () => showStackModal(log)
      }, [icon("code"), "View Details"])
    ])
  );
  return tr;
}

function showStackModal(log) {
  const body = el("div", { style: "display: flex; flex-direction: column; gap: var(--sp-4);" }, [
    el("div", {}, [
      el("label", { class: "form-label" }, "Error Message"),
      el("div", { class: "text-sm", style: "background: var(--color-cream); padding: var(--sp-3); border-radius: var(--radius-sm);" }, log.message)
    ]),
    el("div", {}, [
      el("label", { class: "form-label" }, "Stack Trace"),
      el("pre", { style: "background: var(--color-ink); color: #fff; padding: var(--sp-3); border-radius: var(--radius-sm); font-size: 11px; overflow-x: auto; max-height: 300px; white-space: pre-wrap;" }, log.stack || "No stack trace available.")
    ]),
    el("div", {}, [
      el("label", { class: "form-label" }, "User Agent"),
      el("div", { class: "text-xs text-muted", style: "word-break: break-all;" }, log.userAgent || "Unknown")
    ])
  ]);
  openModal(`Error Details: ${log.code}`, body);
}

function renderTable() {
  if (logs.length === 0) {
    return el("div", { class: "card" }, [
      el("div", { class: "empty-state" }, [
        el("span", { class: "material-symbols-rounded icon empty-state__icon" }, "check_circle"),
        el("h3", {}, "No Errors Found"),
        el("p", { class: "text-muted" }, "No error logs matched your search or the log is empty.")
      ])
    ]);
  }

  return el("div", { class: "card" }, [
    el("div", { class: "table-wrap table-wrap--responsive" }, [
      el("table", {}, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", { style: "width: 140px;" }, "Code"),
            el("th", {}, "Error & Path"),
            el("th", {}, "School/User ID"),
            el("th", { style: "width: 160px;" }, "Time"),
            el("th", { style: "width: 120px;" }, "")
          ])
        ]),
        el("tbody", {}, logs.map(renderRow))
      ])
    ])
  ]);
}

export default async function render(container, profile) {
  container.innerHTML = "";

  const searchInput = el("input", {
    type: "text",
    class: "input",
    placeholder: "Search EKA- code...",
    style: "max-width: 300px;"
  });

  const searchBtn = el("button", { class: "btn btn--primary" }, [icon("search"), "Search"]);
  const clearBtn = el("button", { class: "btn btn--ghost" }, "Clear");

  const header = el("div", { class: "page-header" }, [
    el("div", { class: "page-header__title" }, [
      el("h2", {}, "Error Logs"),
      el("p", { class: "text-muted" }, "View technical crash reports and trace EKA- codes.")
    ]),
    el("div", { class: "page-header__actions" }, [
      searchInput,
      searchBtn,
      clearBtn
    ])
  ]);

  container.append(header);
  
  const tableContainer = el("div", { class: "page-content" }, [
    el("div", { class: "empty-state" }, [
      el("span", { class: "spinner spinner--md spinner--dark" })
    ])
  ]);
  container.append(tableContainer);

  const loadData = async (code = null) => {
    try {
      logs = await listErrorLogs(code);
      tableContainer.innerHTML = "";
      tableContainer.append(renderTable());
    } catch (err) {
      toast("Could not load error logs.", "error");
    }
  };

  searchBtn.addEventListener("click", async () => {
    const code = searchInput.value.trim().toUpperCase();
    await busyButton(searchBtn, () => loadData(code || null));
  });

  clearBtn.addEventListener("click", async () => {
    searchInput.value = "";
    await busyButton(clearBtn, () => loadData());
  });

  await loadData();
}
