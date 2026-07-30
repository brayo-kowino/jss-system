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

export async function render({ profile }) {
  const settings = await getSchoolSettings();
  const [students, teachers, parents, attendanceToday, feesCollected] = await Promise.all([
    safeCount("students"),
    safeCount("teachers"),
    safeCount("parents"),
    getTodayAttendanceStat(),
    getTermCollectionTotal(settings.currentAcademicYear, settings.currentTerm),
  ]);

  const wrap = el("div", {});
  wrap.append(
    el("div", { class: "page-header" }, [
      el("div", {}, [
        el("h1", {}, `Welcome back, ${profile.fullName || profile.email}`),
        el("p", {}, settings.schoolName
          ? `${settings.schoolName} · ${settings.currentTerm || ""} ${settings.currentAcademicYear || ""}`
          : "Finish setting up your school details in School Settings."),
      ]),
    ])
  );

  const stats = el("div", { class: "stat-grid" });
  const cards = [
    { label: "Students", value: students },
    { label: "Teachers", value: teachers },
    { label: "Parents", value: parents },
    { label: "Attendance Today", value: attendanceToday },
    { label: "Fees Collected (Term)", value: formatKES(feesCollected) },
    { label: "Upcoming Exams", value: "—" },
  ];
  for (const c of cards) {
    stats.append(
      el("div", { class: "stat-card" }, [
        el("div", { class: "stat-card__label" }, c.label),
        el("div", { class: "stat-card__value numeric" }, String(c.value)),
      ])
    );
  }
  wrap.append(stats);

  if (!students) {
    wrap.append(
      el("div", { class: "card empty-state" }, [
        el("h3", {}, "No students yet"),
        el("p", {}, "Once the Student Management module is built, admissions and rosters will show up here."),
      ])
    );
  }

  return wrap;
}

export function init() {}