function storageKey(profile, workspace) {
  if (!profile?.uid || !profile.schoolId) return null;
  return `eeskia:workspace:${encodeURIComponent(profile.schoolId)}:${encodeURIComponent(profile.uid)}:${workspace}`;
}

export function restoreWorkspaceSelection(profile, workspace) {
  const key = storageKey(profile, workspace);
  if (!key) return {};
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}

export function rememberWorkspaceSelection(profile, workspace, selection) {
  const key = storageKey(profile, workspace);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(selection));
  } catch {
    // The current workspace still works when browser storage is unavailable.
  }
}

export function workspaceOption(choices, preferred, autoSelect = true) {
  if (choices.includes(preferred)) return preferred;
  return autoSelect && choices.length === 1 ? choices[0] : "";
}

// A grade-only link may resolve to a stream when that grade has one valid cohort.
export function workspaceCohort(choices, preferred, linked = false) {
  if (linked && typeof preferred === "string" && preferred.endsWith("|")) {
    const gradeChoices = choices.filter((value) => value.startsWith(preferred));
    return workspaceOption(gradeChoices, preferred);
  }
  return workspaceOption(choices, preferred, !linked && preferred !== "");
}

export function workspacePeriod(settings, params = {}) {
  const terms = settings.terms?.length ? settings.terms : [settings.currentTerm].filter(Boolean);
  const term = params.term ?? settings.currentTerm ?? terms[0];
  return {
    academicYear: String(params.academicYear ?? params.year ?? settings.currentAcademicYear ?? ""),
    term: workspaceOption(terms, term, !params.term) || (params.term ? "" : terms[0] || ""),
    terms,
  };
}
