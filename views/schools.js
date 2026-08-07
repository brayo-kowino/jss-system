// Platform-level Schools registry - super_admin only.
// Create new schools (each gets its own admin login), see every school on
// the platform, and suspend/reactivate one (suspended schools' users are
// still logged in status-wise, but you'd typically also suspend their
// admin account - full lockout on suspend is a good follow-up).
import { listSchools, createSchool, setSchoolStatus } from "../js/services/school.service.js";
import { openModal } from "../js/components/modal.js";
import { el, icon, toast, formatDate, busyButton } from "../js/utils.js";

let schools = [];

export async function render({ profile }) {
  schools = await listSchools();

  const wrap = el("div", {});
  wrap.append(
    el("div", { class: "page-header" }, [
      el("div", {}, [
        el("p", {}, "Every school on the platform. Create a new one to activate its first admin login."),
      ]),
      el("button", { class: "btn btn--primary", id: "new-school-btn" }, [
        el("span", { class: "material-symbols-rounded" }, "add_business"),
        " New School",
      ]),
    ])
  );

  if (!schools.length) {
    wrap.append(el("div", { class: "card empty-state" }, [icon("corporate_fare", "empty-state__icon"), el("h3", {}, "No schools yet"), el("p", {}, "Create the first one to get started.")]));
    return wrap;
  }

  const tableWrap = el("div", { class: "table-wrap card" });
  const table = el("table", {}, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "School"), el("th", {}, "Contact"), el("th", {}, "Status"), el("th", {}, "Created"), el("th", {}, ""),
    ])),
  ]);
  const tbody = el("tbody");
  for (const s of schools) {
    tbody.append(
      el("tr", {}, [
        el("td", {}, [el("strong", {}, s.schoolName || "(unnamed)"), el("div", { class: "text-sm text-muted" }, s.address || "")]),
        el("td", {}, [el("div", {}, s.email || "N/A"), el("div", { class: "text-sm text-muted" }, s.phone || "")]),
        el("td", {}, el("span", { class: `badge badge--${s.status === "active" ? "green" : "red"}` }, s.status || "active")),
        el("td", {}, s.createdAt ? formatDate(s.createdAt) : "N/A"),
        el("td", {}, [
          el("button", {
            class: "btn btn--sm btn--ghost",
            onClick: (e) => toggleStatus(profile, s, e.currentTarget),
          }, [icon(s.status === "suspended" ? "play_circle" : "pause_circle"), s.status === "suspended" ? "Reactivate" : "Suspend"]),
        ]),
      ])
    );
  }
  table.append(tbody);
  tableWrap.append(table);
  wrap.append(tableWrap);

  return wrap;
}

export function init({ profile }) {
  document.getElementById("new-school-btn")?.addEventListener("click", () => openNewSchoolModal(profile));
}

function openNewSchoolModal(profile) {
  const form = el("form", {}, [
    el("h4", { style: "margin:4px 0 12px;" }, "School details"),
    field("s-name", "School Name"),
    field("s-address", "Address"),
    field("s-phone", "Phone"),
    field("s-email", "School Email", "email"),
    el("h4", { style: "margin:20px 0 12px;" }, "First admin login"),
    field("a-name", "Admin Full Name"),
    field("a-email", "Admin Email", "email"),
    field("a-pass", "Temporary Password", "text"),
    el("button", { type: "submit", class: "btn btn--primary", style: "margin-top:8px;" }, [icon("add_business"), "Create school"]),
  ]);

  const close = openModal("New School", form);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const restore = busyButton(e.submitter, "Creating…");
    try {
      await createSchool(profile.uid, {
        name: val("s-name"),
        address: val("s-address"),
        phone: val("s-phone"),
        email: val("s-email"),
        adminFullName: val("a-name"),
        adminEmail: val("a-email"),
        tempPassword: val("a-pass"),
      });
      toast("School created - share the admin login with them.", "success");
      close();
      const { navigate } = await import("../js/router.js");
      navigate("/schools");
      // Force a re-render since navigate() no-ops on same-path hash changes.
      const { renderRoute } = await import("../js/router.js");
      renderRoute();
    } catch (err) {
      toast(err.message || "Couldn't create school.", "error");
      restore();
    }
  });
}

async function toggleStatus(profile, school, button) {
  const next = school.status === "suspended" ? "active" : "suspended";
  const restore = button ? busyButton(button) : () => {};
  try {
    await setSchoolStatus(profile.uid, school.id, next);
    toast(`${school.schoolName || "School"} ${next === "suspended" ? "suspended" : "reactivated"}.`, "success");
    const { renderRoute } = await import("../js/router.js");
    renderRoute();
  } catch (err) {
    toast(err.message || "Couldn't update school status.", "error");
    restore();
  }
}

function field(id, label, type = "text") {
  return el("div", { class: "field" }, [el("label", { for: id }, label), el("input", { id, type, required: "true" })]);
}

function val(id) {
  return document.getElementById(id).value.trim();
}