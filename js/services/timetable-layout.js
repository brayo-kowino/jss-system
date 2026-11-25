import { DAYS, canMergeLessons, isBreakPeriod, namedTimetableRoom } from "./timetable-rules.js";

const PALETTE = {
  sciences: "#e2ead9",
  languages: "#dfe8f6",
  humanities: "#f8ebcb",
  technical: "#f7e6da",
  creative: "#eee5f2",
  activity: "#e0e9e7",
  study: "#f0f2f4",
};

const SUBJECT_CATEGORIES = {
  sciences: ["MATH", "SCI", "AGR", "BIO", "CHEM", "PHY", "LIB"],
  languages: ["ENG", "KIS", "FREN", "GER", "ARAB"],
  humanities: ["SST", "CRE", "IRE", "HRE", "GEO", "HIST", "PPI"],
  technical: ["PTS", "COMP", "HOME", "AV", "CLUBS"],
  creative: ["CRA", "PE", "PHE", "MUS", "GAMES", "SPORTS", "ASSM", "LIFESKILLS"],
};

export function getTimetableSubjectCategory(code, department = "") {
  const known = Object.entries(SUBJECT_CATEGORIES).find(([, codes]) => codes.includes(String(code || "").toUpperCase()));
  if (known) return known[0];
  const name = department.toLowerCase();
  if (name.includes("science")) return "sciences";
  if (name.includes("language")) return "languages";
  if (name.includes("humanit")) return "humanities";
  if (/tech|applied/.test(name)) return "technical";
  if (/creat|art|sport/.test(name)) return "creative";
  return "";
}

export function buildTimetableGrid({
  kind, periods, days, cohorts = [{}], getSlot, subjectCategory, conflictIds = new Set(), useNamedRooms = true,
}) {
  const columns = periods.map((p) => ({ ...p, isBreak: isBreakPeriod(p), time: [p.startTime, p.endTime].filter(Boolean).join(" - ") }));
  const groups = days.map((day) => ({
    day,
    rows: cohorts.map((cohort) => {
      const cells = [];
      for (let index = 0; index < columns.length; index++) {
        const period = columns[index];
        if (period.isBreak) continue;
        const slot = getSlot(day, period.id, cohort);
        const nextPeriod = columns[index + 1];
        const next = nextPeriod && !nextPeriod.isBreak ? getSlot(day, nextPeriod.id, cohort) : null;
        const merged = canMergeLessons(slot, next, period, nextPeriod, { useNamedRooms });
        const conflict = !!slot && (conflictIds.has(slot.id) || (merged && conflictIds.has(next.id)));
        const isStudy = slot?.subjectCode === "STUDY";
        const isUnstaffed = !!slot && !slot.teacherId && !slot.teacherName && !slot.isActivity && !isStudy;
        const title = slot?.subjectName?.trim() || slot?.subjectCode || "";
        const classLabel = [slot?.grade, slot?.stream].filter(Boolean).join(" ");
        const detail = (kind === "teacher" ? classLabel : slot?.teacherName) || (isUnstaffed ? "Teacher needed" : "");
        const category = isStudy ? "study" : slot?.isActivity ? "activity" :
          slot?.category || subjectCategory?.(slot?.subjectCode);
        cells.push({
          index, period, slot, colspan: merged ? 2 : 1, conflict, isUnstaffed,
          title, detail: [detail, useNamedRooms && namedTimetableRoom(slot?.room)].filter(Boolean).join(" · "),
          fill: conflict ? "#f7dada" : PALETTE[category] || (merged ? "#e8edef" : ""),
          empty: kind === "teacher" ? "FREE / PREP" : "",
        });
        if (merged) index++;
      }
      return { cohort, label: cohort.label || [cohort.grade, cohort.stream].filter(Boolean).join(" "), cells };
    }),
  }));
  return { kind, columns, groups };
}

export function timetableLetterhead(settings, { title, subtitle }) {
  const contact = [settings.address, settings.phone, settings.email].filter(Boolean).join(" · ");
  const term = [settings.currentTerm, settings.currentAcademicYear && `Academic Year ${settings.currentAcademicYear}`]
    .filter(Boolean).join(" · ");
  const logo = /^(https?:\/\/|data:image\/)/i.test(settings.logoUrl || "") ? settings.logoUrl : "";
  return { school: settings.schoolName || "School", contact, motto: settings.motto || "", term, logo, title, subtitle };
}

export function sharedTimetableDisplay(data) {
  const school = data.schoolInfo || {};
  const kind = data.type === "master" || data.type === "teacher" ? data.type : "class";
  const key = (day, periodId, cohort) => JSON.stringify([
    day, periodId, ...(kind === "master" ? [cohort.grade || "", cohort.stream || ""] : []),
  ]);
  const slots = new Map();
  const foundCohorts = new Map();
  for (const slot of data.slots || []) {
    slots.set(key(slot.day, slot.periodId, slot), slot);
    const { grade = "", stream = "" } = slot;
    foundCohorts.set(JSON.stringify([grade, stream]), { grade, stream });
  }
  const cohorts = kind === "master" ? (data.cohorts?.length ? data.cohorts : [...foundCohorts.values()].sort((a, b) =>
    a.grade.localeCompare(b.grade, undefined, { numeric: true }) || a.stream.localeCompare(b.stream))) : [{}];
  const grid = buildTimetableGrid({
    kind, periods: data.periods || [], days: DAYS, cohorts: cohorts.length ? cohorts : [{ label: "All Classes" }],
    getSlot: (day, periodId, cohort) => slots.get(key(day, periodId, cohort)),
    subjectCategory: getTimetableSubjectCategory, useNamedRooms: data.useNamedRooms !== false,
  });
  const letterhead = timetableLetterhead({
    schoolName: school.name, motto: school.motto, logoUrl: school.logoUrl,
    address: school.address, phone: school.phone, email: school.email,
    currentAcademicYear: school.academicYear, currentTerm: school.term,
  }, { title: data.title || "Timetable", subtitle: data.subTitle });
  return { grid, letterhead };
}
