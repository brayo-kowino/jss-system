import { collection, getCountFromServer } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "../js/firebase-config.js";
import { getSchoolSettings } from "../js/services/settings.service.js";
import { getTodayAttendanceStat } from "../js/services/attendance.service.js";
import { getTermCollectionTotal, formatKES } from "../js/services/fee.service.js";
import { el } from "../js/utils.js";

async function safeCount(collectionName) {
  try {
    const snap = await getCountFromServer(collection(db, collectionName));
    return snap.data().count;
  } catch {
    return 0; // collection may not exist yet — that's fine pre-launch
  }
}

function statCardNode({ label, value, icon, loading }) {
  const iconEl = el("span", { class: "material-symbols-rounded icon", "aria-hidden": "true", style: "margin-right:8px;" }, icon);
  if (loading) {
    return el("div", { class: "stat-card fade-in ready" }, [
      el("div", { class: "stat-card__label" }, el("span", { class: "skeleton title" })),
      el("div", { style: "display:flex; align-items:center; justify-content:space-between; gap:8px;" }, [
        el("div", {}, el("div", { class: "skeleton stat" })),
        el("div", {}, el("span", { class: "skeleton avatar" })),
      ]),
    ]);
  }
  return el("div", { class: "stat-card fade-in ready" }, [
    el("div", { class: "stat-card__label" }, label),
    el("div", { style: "display:flex; align-items:center; justify-content:space-between; gap:8px;" }, [
      el("div", { class: "stat-card__value numeric" }, String(value)),
      iconEl,
    ]),
  ]);
}

export async function render({ profile }) {
  const settings = await getSchoolSettings();

  // Show skeleton UI quickly while we fetch counts
  const wrap = el("div", {});
  wrap.append(
    el("div", { class: "page-header" }, [
      el("div", {}, [
        el("h1", {}, [
          el("span", { class: "material-symbols-rounded icon", style: "vertical-align:middle; margin-right:8px;" }, "dashboard"),
          `Welcome back, ${profile.fullName || profile.email}`,
        ]),
        el("p", {}, settings.schoolName
          ? `${settings.schoolName} · ${settings.currentTerm || ""} ${settings.currentAcademicYear || ""}`
          : "Finish setting up your school details in School Settings."),
      ]),
      el("div", {}, [ el("button", { class: "btn btn--ghost btn--sm", id: "refresh-dashboard-btn" }, [ el("span", { class: "material-symbols-rounded icon" }, "refresh"), " Refresh" ]) ]),
    ])
  );

  // skeleton cards (initial)
  const stats = el("div", { class: "stat-grid" });
  const placeholderCards = [
    { label: "Students", icon: "people" },
    { label: "Teachers", icon: "school" },
    { label: "Parents", icon: "family_restroom" },
    { label: "Attendance Today", icon: "event_available" },
    { label: "Fees Collected (Term)", icon: "payments" },
    { label: "Upcoming Exams", icon: "schedule" },
  ];
  for (const p of placeholderCards) {
    stats.append(statCardNode({ label: p.label, loading: true }));
  }
  wrap.append(stats);

  // mount immediately so user sees skeletons, then fetch actual data
  setTimeout(async () => {
    const [students, teachers, parents, attendanceToday, feesCollected] = await Promise.all([
      safeCount("students"),
      safeCount("teachers"),
      safeCount("parents"),
      getTodayAttendanceStat(),
      getTermCollectionTotal(settings.currentAcademicYear, settings.currentTerm),
    ]);

    // replace placeholders with real cards (fade in)
    stats.innerHTML = "";
    const cards = [
      { label: "Students", value: students, icon: "people" },
      { label: "Teachers", value: teachers, icon: "school" },
      { label: "Parents", value: parents, icon: "family_restroom" },
      { label: "Attendance Today", value: attendanceToday, icon: "event_available" },
      { label: "Fees Collected (Term)", value: formatKES(feesCollected), icon: "payments" },
      { label: "Upcoming Exams", value: "—", icon: "schedule" },
    ];
    for (const c of cards) stats.append(statCardNode({ ...c, loading: false }));

    // add refresh handler
    document.getElementById("refresh-dashboard-btn")?.addEventListener("click", () => {
      // simple UX: reload the view (keeps code small & predictable)
      location.hash = "/dashboard";
    });
  }, 120); // small delay so skeleton is visible even on fast connections

  // empty-state card for no students (render after data load)
  const emptyCard = el("div", { class: "card empty-state", style: "display:none;" }, [
    el("h3", {}, "No students yet"),
    el("p", {}, "Once the Student Management module is built, admissions and rosters will show up here."),
  ]);
  wrap.append(emptyCard);

  // a small hook that will show/hide the empty card when real counts arrive
  setTimeout(async () => {
    const students = await safeCount("students");
    if (!students) emptyCard.style.display = "block";
  }, 500);

  return wrap;
}

export function init() {}
