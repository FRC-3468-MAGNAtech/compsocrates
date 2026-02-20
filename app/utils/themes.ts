export interface Theme {
  id: string;
  name: string;
  category: "light" | "dark" | "pride";
  primaryColor: string;
  accentColor: string;
  bgColor: string;
  surfaceColor: string;
  textColor: string;
  mutedTextColor: string;
  subtleTextColor: string;
  headingFont: string;
  bodyFont: string;
  dark?: boolean;
}

export interface FontPreset {
  id: string;
  name: string;
  headingFont: string;
  bodyFont: string;
}

export const DEFAULT_THEME_ID = "light-compsocrates";
export const DEFAULT_FONT_ID = "compsocrates";
const LAST_THEME_KEY = "theme-last-id";
const LAST_FONT_KEY = "font-last-id";

function hexToRgbTuple(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) return [196, 34, 33];
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return [r, g, b];
}

export const themes: Theme[] = [
  // Light
  {
    id: "light-compsocrates",
    name: "CompSocrates Light",
    category: "light",
    primaryColor: "#c42221",
    accentColor: "#8b1818",
    bgColor: "#f3f4f6",
    surfaceColor: "#ffffff",
    textColor: "#111827",
    mutedTextColor: "#4b5563",
    subtleTextColor: "#6b7280",
    headingFont: "'Trebuchet MS', 'Segoe UI', sans-serif",
    bodyFont: "'Segoe UI', 'Tahoma', sans-serif",
  },
  {
    id: "light-atlantic",
    name: "Atlantic",
    category: "light",
    primaryColor: "#1463c2",
    accentColor: "#0c3f8a",
    bgColor: "#eff6ff",
    surfaceColor: "#ffffff",
    textColor: "#111827",
    mutedTextColor: "#334155",
    subtleTextColor: "#64748b",
    headingFont: "'Trebuchet MS', 'Segoe UI', sans-serif",
    bodyFont: "'Segoe UI', 'Tahoma', sans-serif",
  },
  {
    id: "light-emerald",
    name: "Emerald Light",
    category: "light",
    primaryColor: "#0f8a5f",
    accentColor: "#0b5d42",
    bgColor: "#ecfdf5",
    surfaceColor: "#ffffff",
    textColor: "#111827",
    mutedTextColor: "#334155",
    subtleTextColor: "#64748b",
    headingFont: "'Trebuchet MS', 'Segoe UI', sans-serif",
    bodyFont: "'Segoe UI', 'Tahoma', sans-serif",
  },
  {
    id: "light-amber",
    name: "Amber Light",
    category: "light",
    primaryColor: "#b36b00",
    accentColor: "#7a4a00",
    bgColor: "#fffbeb",
    surfaceColor: "#ffffff",
    textColor: "#111827",
    mutedTextColor: "#374151",
    subtleTextColor: "#6b7280",
    headingFont: "'Trebuchet MS', 'Segoe UI', sans-serif",
    bodyFont: "'Segoe UI', 'Tahoma', sans-serif",
  },
  {
    id: "light-deep-purple",
    name: "Deep Purple Light",
    category: "light",
    primaryColor: "#5b2a86",
    accentColor: "#3f1d63",
    bgColor: "#ddcbe9",
    surfaceColor: "#ceb5df",
    textColor: "#1f0e33",
    mutedTextColor: "#3a1e56",
    subtleTextColor: "#52306f",
    headingFont: "'Trebuchet MS', 'Segoe UI', sans-serif",
    bodyFont: "'Segoe UI', 'Tahoma', sans-serif",
  },
  {
    id: "light-deep-red",
    name: "Deep Red Light",
    category: "light",
    primaryColor: "#8a1f2d",
    accentColor: "#621520",
    bgColor: "#e7c4cb",
    surfaceColor: "#dca7b1",
    textColor: "#2f0f14",
    mutedTextColor: "#4a1a24",
    subtleTextColor: "#5f2430",
    headingFont: "'Trebuchet MS', 'Segoe UI', sans-serif",
    bodyFont: "'Segoe UI', 'Tahoma', sans-serif",
  },

  // Dark
  {
    id: "dark-compsocrates",
    name: "CompSocrates Dark",
    category: "dark",
    primaryColor: "#c42221",
    accentColor: "#8b1818",
    bgColor: "#0f1117",
    surfaceColor: "#171a22",
    textColor: "#e5e7eb",
    mutedTextColor: "#cbd5e1",
    subtleTextColor: "#94a3b8",
    headingFont: "'Trebuchet MS', 'Segoe UI', sans-serif",
    bodyFont: "'Segoe UI', 'Tahoma', sans-serif",
    dark: true,
  },
  {
    id: "dark-indigo",
    name: "Indigo Dark",
    category: "dark",
    primaryColor: "#7c87ff",
    accentColor: "#4953d8",
    bgColor: "#0d1326",
    surfaceColor: "#131b33",
    textColor: "#e5e7eb",
    mutedTextColor: "#cbd5e1",
    subtleTextColor: "#94a3b8",
    headingFont: "'Trebuchet MS', 'Segoe UI', sans-serif",
    bodyFont: "'Segoe UI', 'Tahoma', sans-serif",
    dark: true,
  },
  {
    id: "dark-forest",
    name: "Forest Dark",
    category: "dark",
    primaryColor: "#3ebd87",
    accentColor: "#20885e",
    bgColor: "#0f1e1a",
    surfaceColor: "#152823",
    textColor: "#e5e7eb",
    mutedTextColor: "#cbd5e1",
    subtleTextColor: "#94a3b8",
    headingFont: "'Trebuchet MS', 'Segoe UI', sans-serif",
    bodyFont: "'Segoe UI', 'Tahoma', sans-serif",
    dark: true,
  },
  {
    id: "dark-copper",
    name: "Copper Dark",
    category: "dark",
    primaryColor: "#f48f4f",
    accentColor: "#c8642c",
    bgColor: "#1a1310",
    surfaceColor: "#241b16",
    textColor: "#e5e7eb",
    mutedTextColor: "#d1d5db",
    subtleTextColor: "#9ca3af",
    headingFont: "'Trebuchet MS', 'Segoe UI', sans-serif",
    bodyFont: "'Segoe UI', 'Tahoma', sans-serif",
    dark: true,
  },
  {
    id: "dark-deep-purple",
    name: "Deep Purple Dark",
    category: "dark",
    primaryColor: "#8b5cf6",
    accentColor: "#5b2a86",
    bgColor: "#1a102a",
    surfaceColor: "#24163a",
    textColor: "#efe9ff",
    mutedTextColor: "#d8c8ff",
    subtleTextColor: "#bba4e6",
    headingFont: "'Trebuchet MS', 'Segoe UI', sans-serif",
    bodyFont: "'Segoe UI', 'Tahoma', sans-serif",
    dark: true,
  },
  {
    id: "dark-deep-red",
    name: "Deep Red Dark",
    category: "dark",
    primaryColor: "#b12a3b",
    accentColor: "#7e1e2b",
    bgColor: "#1f0b0f",
    surfaceColor: "#2b1016",
    textColor: "#ffe7eb",
    mutedTextColor: "#f0c7cf",
    subtleTextColor: "#d89aa8",
    headingFont: "'Trebuchet MS', 'Segoe UI', sans-serif",
    bodyFont: "'Segoe UI', 'Tahoma', sans-serif",
    dark: true,
  },

  // Pride
  {
    id: "pride-gay",
    name: "Gay Pride",
    category: "pride",
    primaryColor: "#078d70",
    accentColor: "#5049cc",
    bgColor: "#e9fbf2",
    surfaceColor: "#ffffff",
    textColor: "#111827",
    mutedTextColor: "#374151",
    subtleTextColor: "#6b7280",
    headingFont: "'Trebuchet MS', 'Segoe UI', sans-serif",
    bodyFont: "'Segoe UI', 'Tahoma', sans-serif",
  },
  {
    id: "pride-lesbian",
    name: "Lesbian Pride",
    category: "pride",
    primaryColor: "#d62800",
    accentColor: "#a30262",
    bgColor: "#ffe2d2",
    surfaceColor: "#ffffff",
    textColor: "#111827",
    mutedTextColor: "#374151",
    subtleTextColor: "#6b7280",
    headingFont: "'Trebuchet MS', 'Segoe UI', sans-serif",
    bodyFont: "'Segoe UI', 'Tahoma', sans-serif",
  },
  {
    id: "pride-bi",
    name: "Bisexual Pride",
    category: "pride",
    primaryColor: "#d60270",
    accentColor: "#0038a8",
    bgColor: "#f2d4e6",
    surfaceColor: "#ffffff",
    textColor: "#111827",
    mutedTextColor: "#374151",
    subtleTextColor: "#6b7280",
    headingFont: "'Trebuchet MS', 'Segoe UI', sans-serif",
    bodyFont: "'Segoe UI', 'Tahoma', sans-serif",
  },
  {
    id: "pride-pan",
    name: "Pansexual Pride",
    category: "pride",
    primaryColor: "#ff218c",
    accentColor: "#21b1ff",
    bgColor: "#ffe168",
    surfaceColor: "#ffffff",
    textColor: "#111827",
    mutedTextColor: "#374151",
    subtleTextColor: "#6b7280",
    headingFont: "'Trebuchet MS', 'Segoe UI', sans-serif",
    bodyFont: "'Segoe UI', 'Tahoma', sans-serif",
  },
  {
    id: "pride-aromantic",
    name: "Aromantic Pride",
    category: "pride",
    primaryColor: "#3aa63f",
    accentColor: "#000000",
    bgColor: "#e3f4d1",
    surfaceColor: "#ffffff",
    textColor: "#111827",
    mutedTextColor: "#374151",
    subtleTextColor: "#6b7280",
    headingFont: "'Trebuchet MS', 'Segoe UI', sans-serif",
    bodyFont: "'Segoe UI', 'Tahoma', sans-serif",
  },
  {
    id: "pride-asexual",
    name: "Asexual Pride",
    category: "pride",
    primaryColor: "#800080",
    accentColor: "#000000",
    bgColor: "#d8d8d8",
    surfaceColor: "#ffffff",
    textColor: "#111827",
    mutedTextColor: "#374151",
    subtleTextColor: "#6b7280",
    headingFont: "'Trebuchet MS', 'Segoe UI', sans-serif",
    bodyFont: "'Segoe UI', 'Tahoma', sans-serif",
  },
  {
    id: "pride-aroace",
    name: "Aroace Pride",
    category: "pride",
    primaryColor: "#1f3552",
    accentColor: "#e28c2a",
    bgColor: "#ffe89a",
    surfaceColor: "#ffffff",
    textColor: "#111827",
    mutedTextColor: "#374151",
    subtleTextColor: "#6b7280",
    headingFont: "'Trebuchet MS', 'Segoe UI', sans-serif",
    bodyFont: "'Segoe UI', 'Tahoma', sans-serif",
  },
  {
    id: "pride-demisexual",
    name: "Demisexual Pride",
    category: "pride",
    primaryColor: "#000000",
    accentColor: "#6e0070",
    bgColor: "#d9d9d9",
    surfaceColor: "#ffffff",
    textColor: "#111827",
    mutedTextColor: "#374151",
    subtleTextColor: "#6b7280",
    headingFont: "'Trebuchet MS', 'Segoe UI', sans-serif",
    bodyFont: "'Segoe UI', 'Tahoma', sans-serif",
  },
  {
    id: "pride-nonbinary",
    name: "Nonbinary Pride",
    category: "pride",
    primaryColor: "#9b59d0",
    accentColor: "#2c2c2c",
    bgColor: "#fff179",
    surfaceColor: "#ffffff",
    textColor: "#111827",
    mutedTextColor: "#374151",
    subtleTextColor: "#6b7280",
    headingFont: "'Trebuchet MS', 'Segoe UI', sans-serif",
    bodyFont: "'Segoe UI', 'Tahoma', sans-serif",
  },
  {
    id: "pride-trans",
    name: "Trans Pride",
    category: "pride",
    primaryColor: "#5bcffb",
    accentColor: "#f5abb9",
    bgColor: "#e6f7ff",
    surfaceColor: "#ffffff",
    textColor: "#111827",
    mutedTextColor: "#374151",
    subtleTextColor: "#6b7280",
    headingFont: "'Trebuchet MS', 'Segoe UI', sans-serif",
    bodyFont: "'Segoe UI', 'Tahoma', sans-serif",
  },
  {
    id: "pride-genderfluid",
    name: "Genderfluid Pride",
    category: "pride",
    primaryColor: "#2f3dbb",
    accentColor: "#2f2f2f",
    bgColor: "#ffd2e6",
    surfaceColor: "#ffffff",
    textColor: "#111827",
    mutedTextColor: "#374151",
    subtleTextColor: "#6b7280",
    headingFont: "'Trebuchet MS', 'Segoe UI', sans-serif",
    bodyFont: "'Segoe UI', 'Tahoma', sans-serif",
  },
  {
    id: "pride-genderqueer",
    name: "Genderqueer Pride",
    category: "pride",
    primaryColor: "#4a8123",
    accentColor: "#b57edc",
    bgColor: "#eefee7",
    surfaceColor: "#ffffff",
    textColor: "#111827",
    mutedTextColor: "#374151",
    subtleTextColor: "#6b7280",
    headingFont: "'Trebuchet MS', 'Segoe UI', sans-serif",
    bodyFont: "'Segoe UI', 'Tahoma', sans-serif",
  },
  {
    id: "pride-agender",
    name: "Agender Pride",
    category: "pride",
    primaryColor: "#000000",
    accentColor: "#b8f483",
    bgColor: "#ededed",
    surfaceColor: "#ffffff",
    textColor: "#111827",
    mutedTextColor: "#374151",
    subtleTextColor: "#6b7280",
    headingFont: "'Trebuchet MS', 'Segoe UI', sans-serif",
    bodyFont: "'Segoe UI', 'Tahoma', sans-serif",
  },
];

export const fontPresets: FontPreset[] = [
  {
    id: "compsocrates",
    name: "CompSocrates",
    headingFont: "'Trebuchet MS', 'Segoe UI', sans-serif",
    bodyFont: "'Segoe UI', 'Tahoma', sans-serif",
  },
  {
    id: "clean",
    name: "Clean",
    headingFont: "'Verdana', 'Tahoma', sans-serif",
    bodyFont: "'Tahoma', 'Segoe UI', sans-serif",
  },
  {
    id: "classic",
    name: "Classic",
    headingFont: "'Georgia', 'Times New Roman', serif",
    bodyFont: "'Cambria', 'Times New Roman', serif",
  },
  {
    id: "rounded",
    name: "Rounded",
    headingFont: "'Arial Rounded MT Bold', 'Trebuchet MS', sans-serif",
    bodyFont: "'Segoe UI', 'Verdana', sans-serif",
  },
];

const CUSTOM_THEME_KEY = (userId: string) => `theme-custom-${userId}`;

export function saveCustomTheme(userId: string, theme: Theme) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(CUSTOM_THEME_KEY(userId), JSON.stringify(theme));
}

export function loadCustomTheme(userId: string): Theme | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(CUSTOM_THEME_KEY(userId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Theme;
    if (!parsed?.primaryColor || !parsed?.accentColor) return null;
    return { ...parsed, id: "custom", name: parsed.name || "Custom Gradient" };
  } catch {
    return null;
  }
}

export function getTheme(themeId: string, userId?: string): Theme {
  if (themeId === "custom" && userId) {
    const custom = loadCustomTheme(userId);
    if (custom) return custom;
  }
  return themes.find((theme) => theme.id === themeId) || themes.find((theme) => theme.id === DEFAULT_THEME_ID) || themes[0];
}

export function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;

  const isDark = Boolean(theme.dark || theme.category === "dark");
  const [primaryR, primaryG, primaryB] = hexToRgbTuple(theme.primaryColor);
  const [accentR, accentG, accentB] = hexToRgbTuple(theme.accentColor);
  const pageCanvas = theme.bgColor;
  const surfaceColor = theme.surfaceColor;
  const surfaceRaisedColor = theme.surfaceColor;
  const borderFromAccent = theme.category === "pride";
  const borderColor = isDark
    ? borderFromAccent
      ? `rgba(${accentR}, ${accentG}, ${accentB}, 0.42)`
      : `rgba(${primaryR}, ${primaryG}, ${primaryB}, 0.38)`
    : borderFromAccent
    ? `rgba(${accentR}, ${accentG}, ${accentB}, 0.28)`
    : `rgba(${primaryR}, ${primaryG}, ${primaryB}, 0.24)`;
  const inputBg = isDark
    ? `rgba(${accentR}, ${accentG}, ${accentB}, 0.22)`
    : `rgba(${accentR}, ${accentG}, ${accentB}, 0.14)`;
  const inputBgDisabled = isDark
    ? `rgba(${accentR}, ${accentG}, ${accentB}, 0.28)`
    : `rgba(${accentR}, ${accentG}, ${accentB}, 0.2)`;
  const actionButtonBg = theme.primaryColor;
  
  document.documentElement.style.setProperty('--primary-color', theme.primaryColor);
  document.documentElement.style.setProperty('--primary-rgb', `${primaryR}, ${primaryG}, ${primaryB}`);
  document.documentElement.style.setProperty('--accent-color', theme.accentColor);
  document.documentElement.style.setProperty('--accent-rgb', `${accentR}, ${accentG}, ${accentB}`);
  document.documentElement.style.setProperty('--primary-gradient', theme.primaryColor);
  document.documentElement.style.setProperty('--theme-text', "#ffffff");
  document.documentElement.style.setProperty('--theme-bg', theme.bgColor);
  document.documentElement.style.setProperty('--theme-page-gradient', theme.bgColor);
  document.documentElement.style.setProperty('--theme-page-canvas', pageCanvas);
  document.documentElement.style.setProperty('--theme-surface', surfaceColor);
  document.documentElement.style.setProperty('--theme-surface-raised', surfaceRaisedColor);
  document.documentElement.style.setProperty('--theme-border', borderColor);
  document.documentElement.style.setProperty('--theme-input-bg', inputBg);
  document.documentElement.style.setProperty('--theme-input-bg-disabled', inputBgDisabled);
  document.documentElement.style.setProperty('--theme-body-text', theme.textColor);
  document.documentElement.style.setProperty('--theme-muted-text', theme.mutedTextColor);
  document.documentElement.style.setProperty('--theme-subtle-text', theme.subtleTextColor);
  document.documentElement.style.setProperty('--theme-font-heading', theme.headingFont);
  document.documentElement.style.setProperty('--theme-font-body', theme.bodyFont);
  document.documentElement.style.setProperty('--theme-action-bg', actionButtonBg);
  document.documentElement.style.setProperty('--theme-is-dark', isDark ? "1" : "0");
  document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
  document.documentElement.setAttribute("data-theme-category", theme.category);
}

export function getFontPreset(fontId: string): FontPreset {
  return fontPresets.find((font) => font.id === fontId) || fontPresets.find((font) => font.id === DEFAULT_FONT_ID) || fontPresets[0];
}

export function applyFontPreset(fontPreset: FontPreset) {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--theme-font-heading", fontPreset.headingFont);
  document.documentElement.style.setProperty("--theme-font-body", fontPreset.bodyFont);
}

export function saveTheme(userId: string, themeId: string) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(`theme-${userId}`, themeId);
  localStorage.setItem(LAST_THEME_KEY, themeId);
}

export function loadTheme(userId: string): string {
  if (typeof localStorage === 'undefined') return DEFAULT_THEME_ID;
  return localStorage.getItem(`theme-${userId}`) || DEFAULT_THEME_ID;
}

export function loadLastTheme(): string {
  if (typeof localStorage === "undefined") return DEFAULT_THEME_ID;
  return localStorage.getItem(LAST_THEME_KEY) || DEFAULT_THEME_ID;
}

export function saveFontPreset(userId: string, fontId: string) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(`font-${userId}`, fontId);
  localStorage.setItem(LAST_FONT_KEY, fontId);
}

export function loadFontPreset(userId: string): string {
  if (typeof localStorage === "undefined") return DEFAULT_FONT_ID;
  return localStorage.getItem(`font-${userId}`) || DEFAULT_FONT_ID;
}

export function loadLastFontPreset(): string {
  if (typeof localStorage === "undefined") return DEFAULT_FONT_ID;
  return localStorage.getItem(LAST_FONT_KEY) || DEFAULT_FONT_ID;
}


