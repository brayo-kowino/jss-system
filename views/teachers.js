import { listTeachers, createTeacher, updateTeacher, setTeacherStatus } from "../js/services/teacher.service.js";
import { listSubjects, listClasses, seedDefaultsIfEmpty } from "../js/services/academic.service.js";
import { createUserAccount, listSchoolUsers, setUserStatus, ROLES } from "../js/services/auth.service.js";
import { openModal } from "../js/components/modal.js";
import { el, icon, toast, busyButton } from "../js/utils.js";

// Roles that can hold a system login at all, in the order they're offered.
// Anyone not in this list (parent/student/admin/super_admin) isn't managed
// from this page - admin accounts are created once, at school setup, by
// the platform super_admin (see createSchool in school.service.js).
const STAFF_LOGIN_ROLES = ["subject_teacher", "class_teacher", "academic_master", "principal", "deputy_principal", "bursar", "registrar"];

// Which of those roles actually teach and so carry a linked `teachers` doc
// (subjects/classes/TSC number). The rest (principal, deputy_principal,
// bursar, registrar) are logins only - no teaching-record fields at all.
const TEACHING_ROLES = ["subject_teacher", "class_teacher", "academic_master"];

// Mirrors firestore.rules' users/{uid} create clause: admin can create a
// login for any staff role, principal only for class_teacher/subject_teacher.
// Kept here (rather than just letting a denied write happen) so the Role
// dropdown never offers an option that would fail on save.
const CREATABLE_ROLES_BY_CREATOR = {
  admin: STAFF_LOGIN_ROLES,
  principal: ["class_teacher", "subject_teacher"],
};

function roleLabel(role) {
  return ROLES.find((r) => r.value === role)?.label || role;
}

let activeTab = "logins"; // "logins" | "roster"
let teachers = [];
let subjects = [];
let classes = [];
let staffUsers = [];

/**
 * Dynamic Academic Staff & Security Administrator mascot with ID badge and security key.
 */
export function buildStaffMascotSvg({ width = 125, height = 110 } = {}) {
  return `
    <svg class="staff-mascot-svg" viewBox="0 0 220 200" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" aria-label="Eeskia Staff Administrator Assistant">
      <!-- Ground Shadow -->
      <ellipse class="support-mascot__shadow" cx="110" cy="190" rx="55" ry="7" fill="rgba(20, 83, 138, 0.15)" />

      <!-- Floating Mascot Body -->
      <g class="support-mascot__body">
        <!-- Educational Textbooks Stack Base -->
        <g class="support-mascot__books">
          <rect x="54" y="174" width="112" height="13" rx="3" fill="#14538A" stroke="#0D3559" stroke-width="1.2" />
          <rect x="58" y="177" width="104" height="2" fill="#93C5FD" opacity="0.85" />
          <rect x="60" y="161" width="100" height="13" rx="3" fill="#059669" stroke="#047857" stroke-width="1.2" />
          <rect x="64" y="164" width="92" height="2" fill="#A7F3D0" opacity="0.9" />
          <rect x="66" y="148" width="88" height="13" rx="3" fill="#C9A227" stroke="#8C6F12" stroke-width="1.2" />
          <rect x="70" y="151" width="80" height="2" fill="#FDE68A" opacity="0.9" />
        </g>

        <!-- Academic Scholar Robe -->
        <path d="M84,124 C78,142 76,154 80,160 L140,160 C144,154 142,142 136,124 Z" fill="#14538A" stroke="#0D3559" stroke-width="1.5" />
        <!-- Gold Sash -->
        <path d="M96,124 L110,150 L124,124 L118,124 L110,138 L102,124 Z" fill="#C9A227" />

        <!-- Left Arm Holding Staff ID Badge Card -->
        <g class="staff-mascot__badge">
          <path d="M84,128 C74,136 74,148 85,152" stroke="#14538A" stroke-width="6.5" stroke-linecap="round" fill="none" />
          <!-- ID Card Lanyard -->
          <path d="M96,124 L72,132" stroke="#C9A227" stroke-width="2" fill="none" />
          <!-- ID Card Body -->
          <rect x="54" y="128" width="26" height="34" rx="3" fill="#FAF6F0" stroke="#0D3559" stroke-width="1.2" transform="rotate(-5 67 145)" />
          <rect x="58" y="132" width="10" height="10" rx="1.5" fill="#14538A" transform="rotate(-5 67 145)" />
          <rect x="58" y="145" width="18" height="2" rx="0.8" fill="#0B2545" transform="rotate(-5 67 145)" />
          <rect x="58" y="149" width="14" height="2" rx="0.8" fill="#64748B" transform="rotate(-5 67 145)" />
          <rect x="58" y="153" width="10" height="2" rx="0.8" fill="#059669" transform="rotate(-5 67 145)" />
          <!-- Hand Holding Badge -->
          <circle cx="85" cy="150" r="4.5" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" />
        </g>

        <!-- Right Arm Raising Golden Security Key with Gleam Animation -->
        <g class="staff-mascot__key">
          <path d="M136,128 C146,134 154,122 150,110" stroke="#14538A" stroke-width="6.5" stroke-linecap="round" fill="none" />
          <circle cx="150" cy="110" r="4.5" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" />
          <!-- Golden Key -->
          <circle cx="160" cy="98" r="7" fill="none" stroke="#F59E0B" stroke-width="2.5" />
          <line x1="164" y1="103" x2="176" y2="115" stroke="#F59E0B" stroke-width="3" stroke-linecap="round" />
          <line x1="172" y1="111" x2="175" y2="108" stroke="#F59E0B" stroke-width="2.5" stroke-linecap="round" />
          <line x1="175" y1="114" x2="178" y2="111" stroke="#F59E0B" stroke-width="2.5" stroke-linecap="round" />
          <!-- Star sparkle -->
          <polygon points="160,86 161.5,89 165,90.5 161.5,92 160,95 158.5,92 155,90.5 158.5,89" fill="#FDE68A" />
        </g>

        <!-- Head -->
        <circle cx="110" cy="92" r="31" fill="#FAF6F0" stroke="#14538A" stroke-width="2.2" />
        <ellipse cx="88" cy="99" rx="5" ry="3.5" fill="#FCA5A5" opacity="0.65" />
        <ellipse cx="132" cy="99" rx="5" ry="3.5" fill="#FCA5A5" opacity="0.65" />

        <!-- Cheerful Eyebrows -->
        <path d="M89,76 Q97,71 103,75" stroke="#8C6F12" stroke-width="2.2" stroke-linecap="round" fill="none" />
        <path d="M131,76 Q123,71 117,75" stroke="#8C6F12" stroke-width="2.2" stroke-linecap="round" fill="none" />

        <!-- Animated Blinking Eyes -->
        <g class="support-mascot__eyes">
          <ellipse cx="98" cy="90" rx="7" ry="8.5" fill="#FFFFFF" stroke="#14538A" stroke-width="1.4" />
          <ellipse cx="122" cy="90" rx="7" ry="8.5" fill="#FFFFFF" stroke="#14538A" stroke-width="1.4" />
          <circle cx="98" cy="92" r="4.4" fill="#0B2545" />
          <circle cx="122" cy="92" r="4.4" fill="#0B2545" />
          <circle cx="96.5" cy="89.5" r="1.8" fill="#FFFFFF" />
          <circle cx="99" cy="93.5" r="0.8" fill="#FFFFFF" />
          <circle cx="120.5" cy="89.5" r="1.8" fill="#FFFFFF" />
          <circle cx="123" cy="93.5" r="0.8" fill="#FFFFFF" />
        </g>

        <!-- Warm Smile -->
        <path d="M102,106 Q110,114 118,106" stroke="#0B2545" stroke-width="2.4" stroke-linecap="round" fill="none" />

        <!-- Graduation Cap (Mortarboard) -->
        <g transform="rotate(-5 110 58)">
          <rect x="95" y="56" width="30" height="13" rx="4" fill="#8C6F12" />
          <polygon points="110,36 154,50 110,61 66,50" fill="#C9A227" stroke="#8C6F12" stroke-width="1.5" />
          <circle cx="110" cy="48.5" r="3" fill="#FAF6F0" />
          <!-- Swaying Tassel -->
          <path class="support-mascot__tassel" d="M110,48.5 C126,52 136,64 133,80" stroke="#FAF6F0" stroke-width="1.8" fill="none" />
          <circle cx="133" cy="81" r="2.5" fill="#FAF6F0" />
        </g>
      </g>
    </svg>
  `;
}

export async function render({ profile }) {
  await seedDefaultsIfEmpty();
  const [t, s, c, u] = await Promise.all([listTeachers(), listSubjects(), listClasses(), listSchoolUsers()]);
  teachers = t; subjects = s; classes = c; staffUsers = u;

  const wrap = el("div", { class: "staff-view-wrap" });

  const logins = staffUsers.filter((u) => STAFF_LOGIN_ROLES.includes(u.role));
  const activeLogins = logins.filter((u) => u.status !== "suspended").length;
  const activeTeachers = teachers.filter((t) => t.status !== "suspended").length;
  const unlinkedCount = teachers.filter((t) => !t.userId).length;

  // 1. Executive Hero Banner
  const mascotWrap = el("div", { style: "display:flex; align-items:center; justify-content:center; flex-shrink:0;" });
  mascotWrap.innerHTML = buildStaffMascotSvg({ width: 125, height: 110 });

  const heroBanner = el("div", { class: "staff-hero" }, [
    el("div", { class: "staff-hero__content" }, [
      el("h1", { class: "staff-hero__title" }, "Staff Directory & System Logins"),
      el("p", { class: "staff-hero__desc" }, "Manage teacher profiles, subject assignments, role permissions, and system login credentials."),
    ]),

    el("div", { class: "staff-hero__mascot-box" }, [
      el("div", { class: "support-speech-bubble" }, "Did you know? You can create a login for any staff like a bursar, registrar, or principal, and allow them access the system without giving them a teaching profile."),
      mascotWrap,
    ]),
  ]);
  wrap.append(heroBanner);

  // 2. Executive KPI Metrics Strip
  const kpis = [
    { label: "System Logins", value: logins.length, icon: "badge", color: "blue" },
    { label: "Active Faculty", value: activeTeachers, icon: "how_to_reg", color: "green" },
    { label: "Active Logins", value: activeLogins, icon: "person_check", color: "green" },
    { label: "Unlinked Roster", value: unlinkedCount, icon: unlinkedCount > 0 ? "link_off" : "link", color: unlinkedCount > 0 ? "gold" : "blue" },
  ];
  const kpiGrid = el("div", { class: "md3-kpi-grid", style: "margin-bottom:var(--sp-4);" });
  for (const k of kpis) {
    const chip = el("div", { class: `md3-kpi-chip md3-kpi-chip--${k.color}` }, [
      el("div", { class: "md3-kpi-chip__icon" }, [icon(k.icon)]),
      el("div", { class: "md3-kpi-chip__data" }, [
        el("div", { class: "md3-kpi-chip__label" }, k.label),
        el("div", { class: "md3-kpi-chip__value numeric" }, String(k.value)),
      ]),
    ]);
    kpiGrid.append(chip);
  }
  wrap.append(kpiGrid);

  // 3. Segmented Tabs
  const tabNav = el("div", { class: "page-tabs no-print", style: "margin-bottom:var(--sp-4);" });
  const panelMount = el("div", { id: "staff-panel-mount" });

  function renderTabs() {
    tabNav.innerHTML = "";
    const tabs = [
      { id: "logins", label: `System Logins (${logins.length})`, iconName: "badge" },
      { id: "roster", label: `Teaching Staff (${teachers.length})`, iconName: "groups" },
    ];
    tabs.forEach((tab) => {
      const btn = el(
        "button",
        {
          type: "button",
          class: `profile-tab ${activeTab === tab.id ? "profile-tab--active" : ""}`,
          onClick: () => {
            if (activeTab === tab.id) return;
            activeTab = tab.id;
            renderTabs();
            renderPanel(panelMount, profile);
          },
        },
        [icon(tab.iconName, "text-xs"), tab.label]
      );
      tabNav.append(btn);
    });
  }

  renderTabs();
  wrap.append(tabNav);
  wrap.append(panelMount);

  renderPanel(panelMount, profile);

  return wrap;
}

export function init() {}

function renderPanel(panel, profile) {
  panel.innerHTML = "";
  if (activeTab === "logins") renderLoginsTab(panel, profile);
  else renderRosterTab(panel, profile);
}

function refreshPanel(profile) {
  const panel = document.querySelector("#staff-panel-mount");
  if (panel) renderPanel(panel, profile);
}

async function refreshAll(profile) {
  const [t, u] = await Promise.all([listTeachers(true), listSchoolUsers()]);
  teachers = t; staffUsers = u;
  refreshPanel(profile);
}

// ============================================================ Logins tab ==

function renderLoginsTab(container, profile) {
  const logins = staffUsers.filter((u) => STAFF_LOGIN_ROLES.includes(u.role));
  let filterText = "";
  let filterRole = "";
  let filterStatus = "";

  // 1. Filter Toolbar Card
  const searchInput = el("input", {
    placeholder: "Search logins by name or email…",
    style: "width:100%; padding:8px 12px 8px 34px; border:1px solid var(--color-line); border-radius:var(--radius-md); font-size:var(--fs-sm); background:var(--color-white); outline:none;",
  });
  const roleSelect = el("select", {
    style: "height:36px; padding:0 10px; border:1px solid var(--color-line); border-radius:var(--radius-md); font-size:var(--fs-sm); background:var(--color-white);",
  }, [
    el("option", { value: "" }, "All Roles"),
    ...STAFF_LOGIN_ROLES.map((r) => el("option", { value: r }, roleLabel(r))),
  ]);
  const statusSelect = el("select", {
    style: "height:36px; padding:0 10px; border:1px solid var(--color-line); border-radius:var(--radius-md); font-size:var(--fs-sm); background:var(--color-white);",
  }, [
    el("option", { value: "" }, "All Statuses"),
    el("option", { value: "active" }, "Active"),
    el("option", { value: "suspended" }, "Suspended"),
  ]);

  const toolbar = el("div", { class: "card", style: "padding:var(--sp-3) var(--sp-4); margin-bottom:var(--sp-4);" }, [
    el("div", { style: "display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;" }, [
      el("div", { style: "display:flex; align-items:center; gap:10px; flex:1; min-width:min(100%, 300px); flex-wrap:wrap;" }, [
        el("div", { style: "position:relative; flex:1; min-width:200px;" }, [
          el("span", {
            class: "material-symbols-rounded",
            style: "position:absolute; left:9px; top:50%; transform:translateY(-50%); font-size:18px; color:var(--color-ink-soft); pointer-events:none;",
          }, "search"),
          searchInput,
        ]),
        roleSelect,
        statusSelect,
      ]),
      el("button", {
        type: "button",
        class: "btn btn--primary btn--sm",
        id: "new-login-btn",
        onClick: () => openCreateLoginModal(profile),
      }, [icon("person_add"), "Create Staff Login"]),
    ]),
  ]);
  container.append(toolbar);

  // 2. Table Card
  const tableCard = el("div", { class: "card", style: "padding:0; overflow:hidden;" });
  const countBadge = el("span", { class: "badge badge--neutral", style: "font-size:11px;" }, `${logins.length} Users`);
  const tableHeader = el("div", {
    style: "display:flex; justify-content:space-between; align-items:center; padding:var(--sp-3) var(--sp-4); border-bottom:1px solid var(--color-line);",
  }, [
    el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
      icon("badge", "text-primary"),
      el("h3", { style: "margin:0; font-size:var(--fs-sm); font-weight:700; color:var(--color-primary-900);" }, "Staff System Logins"),
      countBadge,
    ]),
  ]);
  tableCard.append(tableHeader);

  const tableWrap = el("div", { class: "table-wrap table-wrap--responsive" });
  tableCard.append(tableWrap);
  container.append(tableCard);

  function drawTable() {
    tableWrap.innerHTML = "";
    const filtered = logins.filter((u) => {
      const q = filterText.toLowerCase();
      const matchText = !q || (u.fullName || "").toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q);
      const matchRole = !filterRole || u.role === filterRole;
      const matchStatus = !filterStatus || (filterStatus === "suspended" ? u.status === "suspended" : u.status !== "suspended");
      return matchText && matchRole && matchStatus;
    });

    countBadge.textContent = `${filtered.length} Users`;

    if (!filtered.length) {
      tableWrap.append(el("div", { class: "empty-state", style: "padding:var(--sp-6);" }, [
        icon("badge", "empty-state__icon"),
        el("h3", {}, "No staff logins found"),
        el("p", {}, logins.length ? "Try adjusting your search query or filters." : "Create a login for a class teacher, principal, bursar, or any other staff role."),
      ]));
      return;
    }

    const table = el("table", { class: "reports-table" }, [
      el("thead", {}, el("tr", {}, [
        el("th", { style: "min-width:200px;" }, "Staff Member"),
        el("th", { style: "min-width:200px;" }, "Email / Login ID"),
        el("th", { style: "width:150px;" }, "Assigned Role"),
        el("th", { style: "width:160px;" }, "Teaching Profile"),
        el("th", { style: "width:100px;" }, "Status"),
        el("th", { class: "col-right", style: "width:90px;" }, "Actions"),
      ])),
    ]);
    const tbody = el("tbody", {});
    for (const u of filtered) {
      const linkedTeacher = TEACHING_ROLES.includes(u.role) ? teachers.find((t) => t.userId === u.uid) : null;
      tbody.append(el("tr", {}, [
        el("td", { "data-label": "Staff Member" }, [
          el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
            el("div", {
              style: "width:32px; height:32px; border-radius:50%; background:var(--color-primary-100); color:var(--color-primary-700); display:flex; align-items:center; justify-content:center; font-weight:700; font-size:12px; flex-shrink:0;",
            }, (u.fullName || "U").charAt(0).toUpperCase()),
            el("div", { style: "font-weight:600; color:var(--color-primary-900); font-size:var(--fs-sm);" }, u.fullName || "—"),
          ]),
        ]),
        el("td", { "data-label": "Email / Login ID" }, [
          el("div", { style: "font-family:var(--font-mono); font-size:var(--fs-xs); color:var(--color-ink);" }, u.email || "—"),
        ]),
        el("td", { "data-label": "Assigned Role" }, el("span", { class: "badge badge--muted", style: "font-size:11px;" }, roleLabel(u.role))),
        el("td", { "data-label": "Teaching Profile" }, linkedTeacher
          ? el("span", { class: "badge badge--success", style: "font-size:11px;" }, [icon("link", "text-xs"), ` ${linkedTeacher.fullName}`])
          : (TEACHING_ROLES.includes(u.role)
            ? el("span", { class: "badge badge--gold", style: "font-size:11px;" }, "Not linked")
            : el("span", { class: "text-muted", style: "font-size:var(--fs-xs);" }, "Non-teaching"))),
        el("td", { "data-label": "Status" }, el("span", { class: `badge badge--${u.status === "suspended" ? "muted" : "success"}` }, u.status === "suspended" ? "Suspended" : "Active")),
        el("td", { class: "col-right", "data-label": "Actions" }, [
          el("div", { style: "display:inline-flex; gap:6px; justify-content:flex-end;" }, [
            el("button", {
              class: "btn btn--ghost btn--sm",
              style: "padding:4px 8px; font-size:12px;",
              onClick: () => openLoginActionsModal(profile, u, linkedTeacher),
            }, [icon("more_vert"), "Actions"]),
          ]),
        ]),
      ]));
    }
    table.append(tbody);
    tableWrap.append(table);
  }

  drawTable();

  searchInput.addEventListener("input", (e) => { filterText = e.target.value; drawTable(); });
  roleSelect.addEventListener("change", (e) => { filterRole = e.target.value; drawTable(); });
  statusSelect.addEventListener("change", (e) => { filterStatus = e.target.value; drawTable(); });
}

async function toggleLoginStatus(profile, user) {
  const next = user.status === "suspended" ? "active" : "suspended";
  try {
    await setUserStatus(profile.uid, user.uid, next);
    toast(`${user.fullName || "Login"} marked ${next}.`, "success");
    await refreshAll(profile);
  } catch (err) {
    toast(err.message || "Could not update login status.", "error");
  }
}

function openCreateLoginModal(profile, presetTeacher = null) {
  const allowedRoles = CREATABLE_ROLES_BY_CREATOR[profile.role] || [];
  if (!allowedRoles.length) {
    toast("Your account isn't permitted to create staff logins.", "error");
    return;
  }

  const unlinkedTeachers = teachers.filter((t) => !t.userId);
  const body = el("form", {});
  const fieldsMount = el("div", {});
  body.append(fieldsMount);
  body.append(el("button", { type: "submit", class: "btn btn--primary btn--block", style: "margin-top:8px;" }, [icon("person_add"), "Create Login"]));

  const close = openModal(presetTeacher ? `Create Login: ${presetTeacher.fullName}` : "Create Staff Login", body);

  // state for the dynamic middle section of the form
  let selectedRole = presetTeacher
    ? (presetTeacher.teachingAssignments?.length ? "class_teacher" : "subject_teacher")
    : allowedRoles[0];
  let mode = presetTeacher ? "link" : "new"; // "link" | "new" - only meaningful for teaching roles
  let linkTeacherId = presetTeacher?.id || "";

  drawFields();

  function drawFields() {
    fieldsMount.innerHTML = "";
    const roleSelect = el("select", { id: "cl-role" }, allowedRoles.map((r) => el("option", { value: r, ...(r === selectedRole ? { selected: "true" } : {}) }, roleLabel(r))));
    roleSelect.disabled = !!presetTeacher; // preset already implies class_teacher/subject_teacher
    roleSelect.addEventListener("change", () => { selectedRole = roleSelect.value; drawFields(); });
    fieldsMount.append(el("div", { class: "field" }, [el("label", {}, "Role"), roleSelect]));

    const isTeaching = TEACHING_ROLES.includes(selectedRole);

    if (isTeaching && !presetTeacher) {
      const modeSelect = el("select", { id: "cl-mode" }, [
        el("option", { value: "new", ...(mode === "new" ? { selected: "true" } : {}) }, "Create a new teacher record"),
        el("option", { value: "link", ...(mode === "link" ? { selected: "true" } : {}) }, "Link an existing teacher record (no login yet)"),
      ]);
      modeSelect.addEventListener("change", () => { mode = modeSelect.value; drawFields(); });
      fieldsMount.append(el("div", { class: "field" }, [el("label", {}, "Teacher Record"), modeSelect]));
    }

    if (isTeaching && (mode === "link" || presetTeacher)) {
      if (presetTeacher) {
        fieldsMount.append(el("p", { class: "text-muted" }, `Linking to existing record: ${presetTeacher.fullName}`));
      } else {
        if (!unlinkedTeachers.length) {
          fieldsMount.append(el("p", { class: "text-muted" }, "No teaching-staff records without a login are available to link. Add one from the Teaching Staff tab first, or create a new record here."));
        }
        const teacherSelect = el("select", { id: "cl-link-teacher" }, [
          el("option", { value: "" }, "Select teacher record"),
          ...unlinkedTeachers.map((t) => el("option", { value: t.id, ...(t.id === linkTeacherId ? { selected: "true" } : {}) }, t.fullName)),
        ]);
        teacherSelect.addEventListener("change", () => { linkTeacherId = teacherSelect.value; });
        fieldsMount.append(el("div", { class: "field" }, [el("label", {}, "Existing Teacher"), teacherSelect]));
      }
    }

    if (isTeaching && mode === "new" && !presetTeacher) {
      window.clAssignments = [];
      const assignmentsWrap = el("div", { style: "margin-bottom:var(--sp-4);" });
      function drawClAssignments() {
        assignmentsWrap.innerHTML = "";
        if (window.clAssignments.length === 0) {
          assignmentsWrap.append(el("div", { class: "text-muted", style: "font-size:13px; padding:10px; background:var(--color-bg); border-radius:var(--radius-md); text-align:center;" }, "No teaching assignments added yet."));
        } else {
          const list = el("div", { style: "display:flex; flex-direction:column; gap:8px;" });
          for (let i = 0; i < window.clAssignments.length; i++) {
            const a = window.clAssignments[i];
            const sName = subjects.find(s => s.code === a.subjectCode)?.name || a.subjectCode;
            const cName = `${a.grade}${a.stream ? ' ' + a.stream : ''}`;
            const row = el("div", { style: "display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:var(--color-bg); border-radius:var(--radius-md); font-size:13px; border:1px solid var(--color-line);" }, [
              el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
                el("span", { style: "font-weight:600; color:var(--color-primary-900);" }, cName),
                el("span", { style: "color:var(--color-ink-soft);" }, "—"),
                el("span", {}, sName),
              ]),
              el("button", { type: "button", class: "btn btn--ghost text-red", style: "padding:4px; height:auto; min-height:0;", onClick: () => {
                window.clAssignments.splice(i, 1);
                drawClAssignments();
              }}, [icon("delete", "text-sm")]),
            ]);
            list.append(row);
          }
          assignmentsWrap.append(list);
        }
      }

      const classSelect = el("select", { style: "flex:1; padding:8px; border:1px solid var(--color-line); border-radius:var(--radius-md);" }, [
        el("option", { value: "" }, "Select Class"),
        ...classes.flatMap((c) => {
          if (!c.streams || !c.streams.length) return [el("option", { value: `${c.grade}|` }, c.grade)];
          return c.streams.map(s => el("option", { value: `${c.grade}|${s}` }, `${c.grade} ${s}`));
        })
      ]);
      const subjectSelect = el("select", { style: "flex:1; padding:8px; border:1px solid var(--color-line); border-radius:var(--radius-md);" }, [
        el("option", { value: "" }, "Select Subject"),
        ...subjects.map(s => el("option", { value: s.code }, s.name))
      ]);
      const addBtn = el("button", { type: "button", class: "btn btn--secondary", style: "padding:8px 16px;", onClick: () => {
        if (!classSelect.value || !subjectSelect.value) return;
        const [grade, stream] = classSelect.value.split("|");
        const subjectCode = subjectSelect.value;
        if (!window.clAssignments.some(a => a.grade === grade && a.stream === stream && a.subjectCode === subjectCode)) {
          window.clAssignments.push({ grade, stream, subjectCode });
          drawClAssignments();
        }
      }}, "Add");
      const addRow = el("div", { style: "display:flex; gap:8px; margin-bottom:12px;" }, [ classSelect, subjectSelect, addBtn ]);
      drawClAssignments();

      const tscField = selectedRole === "class_teacher"
        ? el("div", { class: "field" }, [el("label", {}, "TSC Number (Optional)"), el("input", { id: "cl-tscNumber", type: "text" })])
        : null;

      fieldsMount.append(
        el("div", { class: "field" }, [el("label", {}, "Full Name"), el("input", { id: "cl-fullName", type: "text" })])
      );
      if (tscField) fieldsMount.append(tscField);
      fieldsMount.append(
          el("div", { class: "field" }, [el("label", {}, "Teaching Assignments (Class & Subject)"), addRow, assignmentsWrap]),
          el("div", { class: "field" }, [
            el("label", {}, "Home-Room Class (Optional)"),
            el("select", { id: "cl-homeroom" }, [
              el("option", { value: "" }, "None (Subject Teacher only)"),
              ...classes.flatMap((c) => {
                if (!c.streams || !c.streams.length) return [el("option", { value: `${c.grade}|` }, c.grade)];
                return c.streams.map(s => el("option", { value: `${c.grade}|${s}` }, `${c.grade} ${s}`));
              })
            ])
          ])
        );
    }

    if (!isTeaching) {
      fieldsMount.append(el("div", { class: "field" }, [el("label", {}, "Full Name"), el("input", { id: "cl-fullName", type: "text" })]));
    }

    // Email is editable unless we're linking an existing teacher record,
    // where it's the login identity and should match what's on file for them.
    const presetLinkedTeacher = presetTeacher || (isTeaching && mode === "link" ? unlinkedTeachers.find((t) => t.id === linkTeacherId) : null);
    fieldsMount.append(el("div", { class: "field" }, [
      el("label", {}, "Email (used to sign in)"),
      el("input", { id: "cl-email", type: "email", value: presetLinkedTeacher?.email || "" }),
    ]));
    fieldsMount.append(el("div", { class: "field" }, [
      el("label", {}, "Temporary Password"),
      el("input", { id: "cl-temppass", type: "text", placeholder: "Given to the person to sign in with the first time" }),
    ]));
  }

  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    const restore = busyButton(e.submitter, "Creating…");
    try {
      const email = val("cl-email");
      const tempPass = val("cl-temppass");
      if (!email) throw new Error("Email is required.");
      if (!tempPass) throw new Error("A temporary password is required.");
      const isTeaching = TEACHING_ROLES.includes(selectedRole);

      let teacherId = null;
      let newTeacherData = null;

      if (isTeaching) {
        if (presetTeacher) {
          teacherId = presetTeacher.id;
        } else if (mode === "link") {
          if (!linkTeacherId) throw new Error("Select which teacher record to link.");
          teacherId = linkTeacherId;
        } else {
          newTeacherData = {
            fullName: val("cl-fullName"), teacherNumber: "", tscNumber: document.getElementById("cl-tscNumber")?.value || "",
            phone: "", email, teachingAssignments: window.clAssignments || [],
          };
        }
      }

      const fullName = isTeaching
        ? (presetTeacher?.fullName || (mode === "link" ? teachers.find((t) => t.id === teacherId)?.fullName : val("cl-fullName")))
        : val("cl-fullName");

      const uid = await createUserAccount({ fullName, email, role: selectedRole, tempPassword: tempPass });

      if (newTeacherData) {
        teacherId = await createTeacher(profile.uid, { ...newTeacherData, userId: uid });
      } else if (teacherId) {
        await updateTeacher(profile.uid, teacherId, { userId: uid, email });
      }

      toast("Login created.", "success");
      close();
      await refreshAll(profile);
    } catch (err) {
      toast(err.message || "Could not create login.", "error");
      restore();
    }
  });
}

function openAssignmentModal(profile, teacher) {
  const body = el("form", {});
  let currentAssignments = [...(teacher?.teachingAssignments || [])];
  const assignmentsWrap = el("div", { style: "margin-bottom:var(--sp-4);" });
  
  function drawAssignments() {
    assignmentsWrap.innerHTML = "";
    if (currentAssignments.length === 0) {
      assignmentsWrap.append(el("div", { class: "text-muted", style: "font-size:13px; padding:10px; background:var(--color-bg); border-radius:var(--radius-md); text-align:center;" }, "No teaching assignments added yet."));
    } else {
      const list = el("div", { style: "display:flex; flex-direction:column; gap:8px;" });
      for (let i = 0; i < currentAssignments.length; i++) {
        const a = currentAssignments[i];
        const sName = subjects.find(s => s.code === a.subjectCode)?.name || a.subjectCode;
        const cName = `${a.grade}${a.stream ? ' ' + a.stream : ''}`;
        
        const row = el("div", { style: "display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:var(--color-bg); border-radius:var(--radius-md); font-size:13px; border:1px solid var(--color-line);" }, [
          el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
            el("span", { style: "font-weight:600; color:var(--color-primary-900);" }, cName),
            el("span", { style: "color:var(--color-ink-soft);" }, "—"),
            el("span", {}, sName),
          ]),
          el("button", { type: "button", class: "btn btn--ghost text-red", style: "padding:4px; height:auto; min-height:0;", onClick: () => {
            currentAssignments.splice(i, 1);
            drawAssignments();
          }}, [icon("delete", "text-sm")]),
        ]);
        list.append(row);
      }
      assignmentsWrap.append(list);
    }
  }

  const classSelect = el("select", { style: "flex:1; padding:8px; border:1px solid var(--color-line); border-radius:var(--radius-md);" }, [
    el("option", { value: "" }, "Select Class"),
    ...classes.flatMap((c) => {
      if (!c.streams || !c.streams.length) return [el("option", { value: `${c.grade}|` }, c.grade)];
      return c.streams.map(s => el("option", { value: `${c.grade}|${s}` }, `${c.grade} ${s}`));
    })
  ]);
  const subjectSelect = el("select", { style: "flex:1; padding:8px; border:1px solid var(--color-line); border-radius:var(--radius-md);" }, [
    el("option", { value: "" }, "Select Subject"),
    ...subjects.map(s => el("option", { value: s.code }, s.name))
  ]);
  const addBtn = el("button", { type: "button", class: "btn btn--secondary", style: "padding:8px 16px;", onClick: () => {
    if (!classSelect.value || !subjectSelect.value) return;
    const [grade, stream] = classSelect.value.split("|");
    const subjectCode = subjectSelect.value;
    if (!currentAssignments.some(a => a.grade === grade && a.stream === stream && a.subjectCode === subjectCode)) {
      currentAssignments.push({ grade, stream, subjectCode });
      drawAssignments();
    }
  }}, "Add");
  const addRow = el("div", { style: "display:flex; gap:8px; margin-bottom:12px;" }, [ classSelect, subjectSelect, addBtn ]);
  drawAssignments();

  body.append(
    el("div", { class: "field" }, [el("label", {}, "Teaching Assignments (Class & Subject)"), addRow, assignmentsWrap]),
      el("div", { class: "field" }, [
        el("label", {}, "Home-Room Class (Optional)"),
        el("select", { id: "m-homeroom" }, [
          el("option", { value: "" }, "None (Subject Teacher only)"),
          ...classes.flatMap((c) => {
            if (!c.streams || !c.streams.length) return [el("option", { value: `${c.grade}|`, ...(teacher?.homeroom === `${c.grade}|` ? {selected:"true"} : {}) }, c.grade)];
            return c.streams.map(s => el("option", { value: `${c.grade}|${s}`, ...(teacher?.homeroom === `${c.grade}|${s}` ? {selected:"true"} : {}) }, `${c.grade} ${s}`));
          })
        ])
      ]),
      el("button", { type: "submit", class: "btn btn--primary btn--block" }, [icon("save"), "Save Changes"]),
  );
  const close = openModal(`Edit Assignment: ${teacher.fullName}`, body);
  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    const restore = busyButton(e.submitter, "Saving…");
    try {
      // In teacher.js we still import updateTeacher, wait - teacher.service has been changed to accept teachingAssignments
      await updateTeacher(profile.uid, teacher.id, { teachingAssignments: currentAssignments, homeroom: document.getElementById("m-homeroom") ? document.getElementById("m-homeroom").value : "" });
      toast("Assignment updated.", "success");
      close();
      await refreshAll(profile);
    } catch (err) {
      toast(err.message || "Could not save assignment.", "error");
      restore();
    }
  });
}

// ============================================================ Roster tab ==
// Teaching staff roster & assignments

function renderRosterTab(container, profile) {
  let filterText = "";
  let filterLink = "";
  let filterStatus = "";

  // 1. Filter Toolbar Card
  const searchInput = el("input", {
    placeholder: "Search teachers by name, TSC no., phone…",
    style: "width:100%; padding:8px 12px 8px 34px; border:1px solid var(--color-line); border-radius:var(--radius-md); font-size:var(--fs-sm); background:var(--color-white); outline:none;",
  });
  const linkSelect = el("select", {
    style: "height:36px; padding:0 10px; border:1px solid var(--color-line); border-radius:var(--radius-md); font-size:var(--fs-sm); background:var(--color-white);",
  }, [
    el("option", { value: "" }, "All Faculty"),
    el("option", { value: "linked" }, "Linked to Login"),
    el("option", { value: "unlinked" }, "Unlinked (No Login)"),
  ]);
  const statusSelect = el("select", {
    style: "height:36px; padding:0 10px; border:1px solid var(--color-line); border-radius:var(--radius-md); font-size:var(--fs-sm); background:var(--color-white);",
  }, [
    el("option", { value: "" }, "All Statuses"),
    el("option", { value: "active" }, "Active"),
    el("option", { value: "suspended" }, "Suspended"),
  ]);

  const toolbar = el("div", { class: "card", style: "padding:var(--sp-3) var(--sp-4); margin-bottom:var(--sp-4);" }, [
    el("div", { style: "display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;" }, [
      el("div", { style: "display:flex; align-items:center; gap:10px; flex:1; min-width:min(100%, 300px); flex-wrap:wrap;" }, [
        el("div", { style: "position:relative; flex:1; min-width:200px;" }, [
          el("span", {
            class: "material-symbols-rounded",
            style: "position:absolute; left:9px; top:50%; transform:translateY(-50%); font-size:18px; color:var(--color-ink-soft); pointer-events:none;",
          }, "search"),
          searchInput,
        ]),
        linkSelect,
        statusSelect,
      ]),
      el("button", {
        type: "button",
        class: "btn btn--primary btn--sm",
        onClick: () => openTeacherForm(profile),
      }, [icon("person_add"), "Add Teacher Record"]),
    ]),
  ]);
  container.append(toolbar);

  // 2. Table Card
  const tableCard = el("div", { class: "card", style: "padding:0; overflow:hidden;" });
  const countBadge = el("span", { class: "badge badge--neutral", style: "font-size:11px;" }, `${teachers.length} Teachers`);
  const tableHeader = el("div", {
    style: "display:flex; justify-content:space-between; align-items:center; padding:var(--sp-3) var(--sp-4); border-bottom:1px solid var(--color-line);",
  }, [
    el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
      icon("groups", "text-primary"),
      el("h3", { style: "margin:0; font-size:var(--fs-sm); font-weight:700; color:var(--color-primary-900);" }, "Faculty Roster & Teaching Load"),
      countBadge,
    ]),
  ]);
  tableCard.append(tableHeader);

  const tableWrap = el("div", { class: "table-wrap table-wrap--responsive" });
  tableCard.append(tableWrap);
  container.append(tableCard);

  function drawTable() {
    tableWrap.innerHTML = "";
    const filtered = teachers.filter((t) => {
      const q = filterText.toLowerCase();
      const matchText = !q ||
        (t.fullName || "").toLowerCase().includes(q) ||
        (t.tscNumber || "").toLowerCase().includes(q) ||
        (t.phone || "").toLowerCase().includes(q) ||
        (t.email || "").toLowerCase().includes(q) ||
        (t.teachingAssignments || []).some(a => {
           const cName = `${a.grade} ${a.stream || ""}`.toLowerCase();
           const sName = (subjects.find(s => s.code === a.subjectCode)?.name || a.subjectCode).toLowerCase();
           return cName.includes(q) || sName.includes(q);
        });
      const matchLink = !filterLink || (filterLink === "linked" ? !!t.userId : !t.userId);
      const matchStatus = !filterStatus || (filterStatus === "suspended" ? t.status === "suspended" : t.status !== "suspended");
      return matchText && matchLink && matchStatus;
    });

    countBadge.textContent = `${filtered.length} Teachers`;

    if (!filtered.length) {
      tableWrap.append(el("div", { class: "empty-state", style: "padding:var(--sp-6);" }, [
        icon("groups", "empty-state__icon"),
        el("h3", {}, "No teacher records found"),
        el("p", {}, teachers.length ? "Try adjusting your search query or filters." : "Add a teacher record to assign subjects and classes."),
      ]));
      return;
    }

    const table = el("table", { class: "reports-table" }, [
      el("thead", {}, el("tr", {}, [
        el("th", { style: "min-width:200px;" }, "Teacher Name"),
        el("th", { style: "width:140px;" }, "TSC No."),
        el("th", { style: "min-width:340px;", colspan: "2" }, "Teaching Assignments"),
        el("th", { style: "width:130px;" }, "Login Link"),
        el("th", { style: "width:100px;" }, "Status"),
        el("th", { class: "col-right", style: "width:90px;" }, "Actions"),
      ])),
    ]);
    const tbody = el("tbody", {});
    for (const t of filtered) {
      const grouped = {};
      for (const a of (t.teachingAssignments || [])) {
        const c = `${a.grade}${a.stream ? ' ' + a.stream : ''}`;
        const s = subjects.find(s => s.code === a.subjectCode)?.name || a.subjectCode;
        if (!grouped[c]) grouped[c] = [];
        grouped[c].push(s);
      }
      const isLinked = !!t.userId;

      tbody.append(el("tr", {}, [
        el("td", { "data-label": "Teacher Name" }, [
          el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
            el("div", {
              style: "width:32px; height:32px; border-radius:50%; background:var(--color-primary-100); color:var(--color-primary-700); display:flex; align-items:center; justify-content:center; font-weight:700; font-size:12px; flex-shrink:0;",
            }, (t.fullName || "T").charAt(0).toUpperCase()),
            el("div", {}, [
              el("div", { style: "font-weight:600; color:var(--color-primary-900); font-size:var(--fs-sm);" }, t.fullName || "—"),
              t.phone ? el("div", { style: "font-size:11px; color:var(--color-ink-soft);" }, t.phone) : null,
            ].filter(Boolean)),
          ]),
        ]),
        el("td", { "data-label": "TSC No." }, [
          el("span", { style: "font-family:var(--font-mono); font-size:var(--fs-xs); font-weight:600; color:var(--color-ink);" }, t.tscNumber || "—"),
        ]),
        el("td", { "data-label": "Assignments", colspan: "2" }, [
          Object.keys(grouped).length > 0
            ? el("div", { style: "display:flex; flex-direction:column; gap:4px;" }, 
                Object.entries(grouped).map(([cName, sNames]) => 
                  el("div", { style: "font-size:12px;" }, [
                    el("span", { style: "font-weight:600; color:var(--color-primary-800); margin-right:6px;" }, cName + ":"),
                    ...sNames.map(name => el("span", { class: "badge badge--neutral", style: "font-size:10px; padding:2px 4px; margin-right:2px;" }, name))
                  ])
                )
              )
            : el("span", { class: "text-muted", style: "font-size:var(--fs-xs);" }, "No subjects assigned"),
        ]),
        el("td", { "data-label": "Login Link" }, isLinked
          ? el("span", { class: "badge badge--success", style: "font-size:11px;" }, [icon("check_circle", "text-xs"), " Linked"])
          : el("span", { class: "badge badge--gold", style: "font-size:11px;" }, [icon("link_off", "text-xs"), " Unlinked"])
        ),
        el("td", { "data-label": "Status" }, el("span", {
          class: `badge badge--${t.status === "suspended" ? "muted" : "success"}`,
          style: "font-size:11px;",
        }, t.status === "suspended" ? "Suspended" : "Active")),
        el("td", { class: "col-right", "data-label": "Actions" }, [
          el("div", { style: "display:inline-flex; gap:6px; justify-content:flex-end;" }, [
            el("button", {
              class: "btn btn--ghost btn--sm",
              style: "padding:4px 8px; font-size:12px;",
              onClick: () => openTeacherActionsModal(profile, t),
            }, [icon("more_vert"), "Actions"]),
          ]),
        ]),
      ]));
    }
    table.append(tbody);
    tableWrap.append(table);
  }

  drawTable();

  searchInput.addEventListener("input", (e) => { filterText = e.target.value; drawTable(); });
  linkSelect.addEventListener("change", (e) => { filterLink = e.target.value; drawTable(); });
  statusSelect.addEventListener("change", (e) => { filterStatus = e.target.value; drawTable(); });
}

function openTeacherActionsModal(profile, teacher) {
  let close;
  const isSuspended = teacher.status === "suspended";
  const body = el("div", { style: "display:flex; flex-direction:column; gap:8px;" });
  
  body.append(
    el("button", {
      class: "btn btn--ghost btn--block",
      style: "justify-content:flex-start; gap:10px; padding:12px 16px; font-size:var(--fs-sm); border-radius:var(--radius-md); transition:background-color 0.2s ease;",
      onClick: () => {
        if (close) close();
        openTeacherForm(profile, teacher);
      }
    }, [icon("edit", "text-primary"), "Edit Teacher Info & Assignments"]),
    
    el("button", {
      class: "btn btn--ghost btn--block",
      style: `justify-content:flex-start; gap:10px; padding:12px 16px; font-size:var(--fs-sm); border-radius:var(--radius-md); transition:background-color 0.2s ease; ${!isSuspended ? "color:var(--color-amber-700);" : "color:var(--color-success);" }`,
      onClick: async () => {
        if (close) close();
        await toggleTeacherStatus(profile, teacher);
      }
    }, [icon(isSuspended ? "restart_alt" : "pause_circle", isSuspended ? "text-success" : "text-amber"), isSuspended ? "Reinstate Teacher Record" : "Suspend Teacher Record"])
  );

  if (!teacher.userId) {
    body.append(
      el("button", {
        class: "btn btn--primary btn--block",
        style: "justify-content:flex-start; gap:10px; padding:12px 16px; font-size:var(--fs-sm); border-radius:var(--radius-md);",
        onClick: () => {
          if (close) close();
          openCreateLoginModal(profile, teacher);
        }
      }, [icon("badge"), "Create Staff System Login"])
    );
  } else {
    const linkedUser = staffUsers.find((u) => u.uid === teacher.userId);
    if (linkedUser) {
      body.append(
        el("button", {
          class: "btn btn--secondary btn--block",
          style: "justify-content:flex-start; gap:10px; padding:12px 16px; font-size:var(--fs-sm); border-radius:var(--radius-md);",
          onClick: () => {
            if (close) close();
            openLoginActionsModal(profile, linkedUser, teacher);
          }
        }, [icon("manage_accounts"), "Manage Linked Login Account"])
      );
    }
  }

  // Divider and Delete Button
  body.append(
    el("hr", { style: "margin:8px 0; border:none; border-top:1px solid var(--color-line);" }),
    el("button", {
      class: "btn btn--ghost btn--block",
      style: "justify-content:flex-start; gap:10px; padding:12px 16px; font-size:var(--fs-sm); color:var(--color-red); border-radius:var(--radius-md); transition:background-color 0.2s ease;",
      onClick: async () => {
        if (!confirm(`Are you sure you want to permanently delete ${teacher.fullName}'s teaching record? This action cannot be undone.`)) return;
        if (close) close();
        try {
          const { deleteTeacher } = await import("../js/services/teacher.service.js");
          await deleteTeacher(profile.uid, teacher.id);
          toast("Teacher record deleted successfully.", "success");
          await refreshAll(profile);
        } catch (err) {
          toast(err.message, "error");
        }
      }
    }, [icon("delete", "text-red"), "Delete Teacher Record"])
  );

  close = openModal(`Teacher: ${teacher.fullName}`, body);
}

function openLoginActionsModal(profile, user, linkedTeacher) {
  let close;
  const isSuspended = user.status === "suspended";
  const body = el("div", { style: "display:flex; flex-direction:column; gap:8px;" });
  
  if (TEACHING_ROLES.includes(user.role) && linkedTeacher) {
    body.append(
      el("button", {
        class: "btn btn--ghost btn--block",
        style: "justify-content:flex-start; gap:10px; padding:12px 16px; font-size:var(--fs-sm); border-radius:var(--radius-md); transition:background-color 0.2s ease;",
        onClick: () => {
          if (close) close();
          openAssignmentModal(profile, linkedTeacher);
        }
      }, [icon("edit", "text-primary"), "Edit Teaching Assignments"])
    );
  }

  if (profile.role === "admin" && user.uid !== profile.uid) {
    body.append(
      el("button", {
        class: "btn btn--ghost btn--block",
        style: `justify-content:flex-start; gap:10px; padding:12px 16px; font-size:var(--fs-sm); border-radius:var(--radius-md); transition:background-color 0.2s ease; ${!isSuspended ? "color:var(--color-amber-700);" : "color:var(--color-success);" }`,
        onClick: async () => {
          if (close) close();
          await toggleLoginStatus(profile, user);
        }
      }, [icon(isSuspended ? "restart_alt" : "pause_circle", isSuspended ? "text-success" : "text-amber"), isSuspended ? "Reinstate Login Account" : "Suspend Login Account"])
    );
  }

  close = openModal(`Login Actions: ${user.fullName || user.email}`, body);
}

async function toggleTeacherStatus(profile, teacher) {
  const next = teacher.status === "active" ? "suspended" : "active";
  try {
    await setTeacherStatus(profile.uid, teacher.id, next);
    toast(`${teacher.fullName} marked ${next}.`, "success");
    await refreshAll(profile);
  } catch (err) {
    toast(err.message || "Could not update teacher status.", "error");
  }
}

function openTeacherForm(profile, existing = null) {
  const isEdit = !!existing;
  const body = el("form", {});

  let currentAssignments = [...(existing?.teachingAssignments || [])];
  const assignmentsWrap = el("div", { style: "margin-bottom:var(--sp-4);" });
  
  function drawAssignments() {
    assignmentsWrap.innerHTML = "";
    if (currentAssignments.length === 0) {
      assignmentsWrap.append(el("div", { class: "text-muted", style: "font-size:13px; padding:10px; background:var(--color-bg); border-radius:var(--radius-md); text-align:center;" }, "No teaching assignments added yet."));
    } else {
      const list = el("div", { style: "display:flex; flex-direction:column; gap:8px;" });
      for (let i = 0; i < currentAssignments.length; i++) {
        const a = currentAssignments[i];
        const sName = subjects.find(s => s.code === a.subjectCode)?.name || a.subjectCode;
        const cName = `${a.grade}${a.stream ? ' ' + a.stream : ''}`;
        
        const row = el("div", { style: "display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:var(--color-bg); border-radius:var(--radius-md); font-size:13px; border:1px solid var(--color-line);" }, [
          el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
            el("span", { style: "font-weight:600; color:var(--color-primary-900);" }, cName),
            el("span", { style: "color:var(--color-ink-soft);" }, "—"),
            el("span", {}, sName),
          ]),
          el("button", { type: "button", class: "btn btn--ghost text-red", style: "padding:4px; height:auto; min-height:0;", onClick: () => {
            currentAssignments.splice(i, 1);
            drawAssignments();
          }}, [icon("delete", "text-sm")]),
        ]);
        list.append(row);
      }
      assignmentsWrap.append(list);
    }
  }

  const classSelect = el("select", { style: "flex:1; padding:8px; border:1px solid var(--color-line); border-radius:var(--radius-md);" }, [
    el("option", { value: "" }, "Select Class"),
    ...classes.flatMap((c) => {
      if (!c.streams || !c.streams.length) return [el("option", { value: `${c.grade}|` }, c.grade)];
      return c.streams.map(s => el("option", { value: `${c.grade}|${s}` }, `${c.grade} ${s}`));
    })
  ]);
  const subjectSelect = el("select", { style: "flex:1; padding:8px; border:1px solid var(--color-line); border-radius:var(--radius-md);" }, [
    el("option", { value: "" }, "Select Subject"),
    ...subjects.map(s => el("option", { value: s.code }, s.name))
  ]);
  const addBtn = el("button", { type: "button", class: "btn btn--secondary", style: "padding:8px 16px;", onClick: () => {
    if (!classSelect.value || !subjectSelect.value) {
      toast("Please select both a class and a subject.", "error");
      return;
    }
    const [grade, stream] = classSelect.value.split("|");
    const subjectCode = subjectSelect.value;
    if (!currentAssignments.some(a => a.grade === grade && a.stream === stream && a.subjectCode === subjectCode)) {
      currentAssignments.push({ grade, stream, subjectCode });
      drawAssignments();
    } else {
      toast("This assignment already exists.", "error");
    }
  }}, "Add");

  const addRow = el("div", { style: "display:flex; gap:8px; margin-bottom:12px;" }, [ classSelect, subjectSelect, addBtn ]);

  const tscField = field("t-tscNumber", "TSC Number (Optional)", existing?.tscNumber);

  drawAssignments();

  body.append(
    field("t-fullName", "Full Name", existing?.fullName),
    field("t-teacherNumber", "Teacher Number", existing?.teacherNumber),
    tscField,
    field("t-email", "Email", existing?.email, "email"),
    
    el("div", { class: "field" }, [
      el("label", {}, "Teaching Assignments (Class & Subject)"),
      addRow,
      assignmentsWrap
    ]),
    
    el("div", { class: "field" }, [
      el("label", {}, "Home-Room Class (Optional)"),
      el("select", { id: "t-homeroom" }, [
        el("option", { value: "" }, "None (Subject Teacher only)"),
        ...classes.flatMap((c) => {
          if (!c.streams || !c.streams.length) return [el("option", { value: `${c.grade}|`, ...(existing?.homeroom === `${c.grade}|` ? {selected:"true"} : {}) }, c.grade)];
          return c.streams.map(s => el("option", { value: `${c.grade}|${s}`, ...(existing?.homeroom === `${c.grade}|${s}` ? {selected:"true"} : {}) }, `${c.grade} ${s}`));
        })
      ])
    ]),
    el("button", { type: "submit", class: "btn btn--primary btn--block" }, [icon(isEdit ? "save" : "person_add"), isEdit ? "Save changes" : "Add teacher"]),
  );

  const close = openModal(isEdit ? `Edit: ${existing.fullName}` : "Add Teacher", body);

  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    const restore = busyButton(e.submitter, isEdit ? "Saving…" : "Adding…");
    
    const data = {
        fullName: val("t-fullName"),
        teacherNumber: val("t-teacherNumber"),
        tscNumber: document.getElementById("t-tscNumber")?.value || "",
        phone: "",
        email: val("t-email"),
        teachingAssignments: currentAssignments,
        homeroom: document.getElementById("t-homeroom") ? document.getElementById("t-homeroom").value : "",
      };
      
    try {
      if (isEdit) {
        await updateTeacher(profile.uid, existing.id, data);
        toast("Teacher updated.", "success");
      } else {
        await createTeacher(profile.uid, data);
        toast("Teacher added.", "success");
      }
      close();
      await refreshAll(profile);
    } catch (err) {
      toast(err.message || "Could not save teacher.", "error");
      restore();
    }
  });
}

function field(id, label, value = "", type = "text") {
  return el("div", { class: "field" }, [el("label", { for: id }, label), el("input", { id, type, value: value || "" })]);
}
function val(id) {
  return document.getElementById(id).value.trim();
}