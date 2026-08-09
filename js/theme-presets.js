// Preset brand themes a school can "install" from School Settings ->
// Branding & Themes. Each preset is just a primary/secondary color pair
// (applyBranding() in shell.js derives the shades/tints from these two),
// plus display metadata for the theme gallery. Schools can still fine-tune
// with the custom color pickers after picking a preset - doing so switches
// the active theme to "custom".
export const THEME_PRESETS = [
  {
    id: "navy-gold",
    name: "Navy & Gold",
    description: "The classic JSS look - navy blazer blue with a warm gold trim.",
    primary: "#14538A",
    secondary: "#C9A227",
  },
  {
    id: "emerald-scholar",
    name: "Emerald Scholar",
    description: "Deep academic green paired with antique gold.",
    primary: "#1B5E4A",
    secondary: "#D9A441",
  },
  {
    id: "crimson-academy",
    name: "Crimson Academy",
    description: "Bold crimson red for schools with a red-and-gold crest.",
    primary: "#8C1D2B",
    secondary: "#C9A227",
  },
  {
    id: "ocean-breeze",
    name: "Ocean Breeze",
    description: "Bright teal-blue with a warm coral-orange accent.",
    primary: "#0E6E8C",
    secondary: "#F2A65A",
  },
  {
    id: "slate-charcoal",
    name: "Slate Charcoal",
    description: "Modern, understated charcoal grey with gold detailing.",
    primary: "#33404D",
    secondary: "#C9A227",
  },
  {
    id: "forest-sand",
    name: "Forest & Sand",
    description: "Earthy forest green with a soft sandstone accent.",
    primary: "#2F5233",
    secondary: "#D8C08A",
  },
  {
    id: "classic-maroon",
    name: "Classic Maroon",
    description: "Deep maroon, a favourite for boarding schools, with gold trim.",
    primary: "#6E1423",
    secondary: "#C9A227",
  },
];

export function findTheme(id) {
  return THEME_PRESETS.find((t) => t.id === id);
}

// Given the settings' saved themeColor/secondaryColor, figure out which
// preset (if any) is currently active, falling back to "custom".
export function matchThemeId(themeColor, secondaryColor) {
  const hit = THEME_PRESETS.find(
    (t) => eqColor(t.primary, themeColor) && eqColor(t.secondary, secondaryColor)
  );
  return hit ? hit.id : "custom";
}

function eqColor(a, b) {
  return (a || "").toLowerCase() === (b || "").toLowerCase();
}
