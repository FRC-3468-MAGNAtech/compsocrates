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

  // Pride
  {
    id: "pride-rainbow",
    name: "Pride Rainbow",
    category: "pride",
    primaryColor: "#e40303",
    accentColor: "#24408e",
    bgColor: "#fff9f3",
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
    bgColor: "#f0f9ff",
    surfaceColor: "#ffffff",
    textColor: "#111827",
    mutedTextColor: "#374151",
    subtleTextColor: "#6b7280",
    headingFont: "'Trebuchet MS', 'Segoe UI', sans-serif",
    bodyFont: "'Segoe UI', 'Tahoma', sans-serif",
  },
  {
    id: "pride-bi",
    name: "Bi Pride",
    category: "pride",
    primaryColor: "#d60270",
    accentColor: "#0038a8",
    bgColor: "#fdf2f8",
    surfaceColor: "#ffffff",
    textColor: "#111827",
    mutedTextColor: "#374151",
    subtleTextColor: "#6b7280",
    headingFont: "'Trebuchet MS', 'Segoe UI', sans-serif",
    bodyFont: "'Segoe UI', 'Tahoma', sans-serif",
  },
  {
    id: "pride-pan",
    name: "Pan Pride",
    category: "pride",
    primaryColor: "#ff218c",
    accentColor: "#21b1ff",
    bgColor: "#fff5fa",
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
    accentColor: "#a40062",
    bgColor: "#fff5f5",
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
    primaryColor: "#9c59d1",
    accentColor: "#2c2c2c",
    bgColor: "#fffef0",
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
  const borderColor = isDark
    ? `rgba(${primaryR}, ${primaryG}, ${primaryB}, 0.38)`
    : `rgba(${primaryR}, ${primaryG}, ${primaryB}, 0.24)`;
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
}

export function loadTheme(userId: string): string {
  if (typeof localStorage === 'undefined') return DEFAULT_THEME_ID;
  return localStorage.getItem(`theme-${userId}`) || DEFAULT_THEME_ID;
}

export function saveFontPreset(userId: string, fontId: string) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(`font-${userId}`, fontId);
}

export function loadFontPreset(userId: string): string {
  if (typeof localStorage === "undefined") return DEFAULT_FONT_ID;
  return localStorage.getItem(`font-${userId}`) || DEFAULT_FONT_ID;
}


