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

export function workspaceOption(choices, requested) {
  if (requested == null) return choices[0] ?? "";
  return choices.includes(requested) ? requested : "";
}

export function workspaceCohort(choices, grade, stream) {
  if (grade == null) {
    if (stream == null) return workspaceOption(choices);
    return choices.find((value) => value.split("|")[1] === stream) ?? "";
  }
  if (stream == null) {
    return choices.find((value) => value.startsWith(`${grade}|`)) ?? "";
  }
  return workspaceOption(choices, `${grade}|${stream}`);
}

export function workspacePeriod(settings, params = {}) {
  const configuredTerms = settings.terms?.length ? settings.terms : [settings.currentTerm].filter(Boolean);
  const terms = configuredTerms.includes(settings.currentTerm)
    ? [settings.currentTerm, ...configuredTerms.filter((term) => term !== settings.currentTerm)]
    : configuredTerms;
  return {
    academicYear: String(params.academicYear ?? params.year ?? settings.currentAcademicYear ?? ""),
    term: workspaceOption(terms, params.term),
    terms,
  };
}
