// FILE: app/utils/themes.ts
// COMPLETE REWRITE - Theme definitions with LGBTQ+ Pride flags

export interface Theme {
  id: string;
  name: string;
  gradient: string;
  primaryColor: string;
  accentColor: string;
  textColor: string;
  bgColor: string;
}

export const themes: Theme[] = [
  // Default
  {
    id: "default",
    name: "CompSocrates Red",
    gradient: "linear-gradient(135deg, #c42221 0%, #8b1818 100%)",
    primaryColor: "#c42221",
    accentColor: "#8b1818",
    textColor: "#ffffff",
    bgColor: "#f9fafb"
  },
  
  // Blue variants
  {
    id: "ocean-blue",
    name: "Ocean Blue",
    gradient: "linear-gradient(135deg, #2563eb 0%, #1e40af 100%)",
    primaryColor: "#2563eb",
    accentColor: "#1e40af",
    textColor: "#ffffff",
    bgColor: "#f0f9ff"
  },
  {
    id: "navy",
    name: "Navy",
    gradient: "linear-gradient(135deg, #1e3a8a 0%, #0f172a 100%)",
    primaryColor: "#1e3a8a",
    accentColor: "#0f172a",
    textColor: "#ffffff",
    bgColor: "#f8fafc"
  },
  {
    id: "cyan",
    name: "Cyan",
    gradient: "linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)",
    primaryColor: "#06b6d4",
    accentColor: "#0891b2",
    textColor: "#ffffff",
    bgColor: "#ecfeff"
  },
  
  // Purple variants
  {
    id: "purple",
    name: "Purple",
    gradient: "linear-gradient(135deg, #9333ea 0%, #7e22ce 100%)",
    primaryColor: "#9333ea",
    accentColor: "#7e22ce",
    textColor: "#ffffff",
    bgColor: "#faf5ff"
  },
  {
    id: "lavender",
    name: "Lavender",
    gradient: "linear-gradient(135deg, #a78bfa 0%, #8b5cf6 100%)",
    primaryColor: "#a78bfa",
    accentColor: "#8b5cf6",
    textColor: "#ffffff",
    bgColor: "#f5f3ff"
  },
  
  // Pink/Rose
  {
    id: "rose",
    name: "Rose",
    gradient: "linear-gradient(135deg, #f43f5e 0%, #e11d48 100%)",
    primaryColor: "#f43f5e",
    accentColor: "#e11d48",
    textColor: "#ffffff",
    bgColor: "#fff1f2"
  },
  {
    id: "pink",
    name: "Pink",
    gradient: "linear-gradient(135deg, #ec4899 0%, #db2777 100%)",
    primaryColor: "#ec4899",
    accentColor: "#db2777",
    textColor: "#ffffff",
    bgColor: "#fdf2f8"
  },
  
  // Green variants
  {
    id: "emerald",
    name: "Emerald",
    gradient: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
    primaryColor: "#10b981",
    accentColor: "#059669",
    textColor: "#ffffff",
    bgColor: "#ecfdf5"
  },
  {
    id: "forest",
    name: "Forest",
    gradient: "linear-gradient(135deg, #22c55e 0%, #16a34a 100%)",
    primaryColor: "#22c55e",
    accentColor: "#16a34a",
    textColor: "#ffffff",
    bgColor: "#f0fdf4"
  },
  
  // Orange/Yellow
  {
    id: "orange",
    name: "Orange",
    gradient: "linear-gradient(135deg, #f97316 0%, #ea580c 100%)",
    primaryColor: "#f97316",
    accentColor: "#ea580c",
    textColor: "#ffffff",
    bgColor: "#fff7ed"
  },
  {
    id: "amber",
    name: "Amber",
    gradient: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
    primaryColor: "#f59e0b",
    accentColor: "#d97706",
    textColor: "#ffffff",
    bgColor: "#fffbeb"
  },
  
  // LGBTQ+ PRIDE FLAGS 🏳️‍🌈
  {
    id: "pride-rainbow",
    name: "Pride Rainbow",
    gradient: "linear-gradient(180deg, #e40303 0%, #ff8c00 16.67%, #ffed00 33.33%, #008026 50%, #24408e 66.67%, #732982 83.33%, #732982 100%)",
    primaryColor: "#e40303",
    accentColor: "#732982",
    textColor: "#ffffff",
    bgColor: "#fff9f0"
  },
  {
    id: "lesbian",
    name: "Lesbian",
    gradient: "linear-gradient(180deg, #d62800 0%, #ff9b56 20%, #ffffff 40%, #d462a6 60%, #a40062 80%, #a40062 100%)",
    primaryColor: "#d62800",
    accentColor: "#a40062",
    textColor: "#ffffff",
    bgColor: "#fff5f5"
  },
  {
    id: "gay",
    name: "Gay",
    gradient: "linear-gradient(180deg, #078d70 0%, #26ceaa 16.67%, #98e8c1 33.33%, #ffffff 50%, #7bade2 66.67%, #5049cc 83.33%, #3d1a78 100%)",
    primaryColor: "#078d70",
    accentColor: "#3d1a78",
    textColor: "#ffffff",
    bgColor: "#f0fdf9"
  },
  {
    id: "bisexual",
    name: "Bisexual",
    gradient: "linear-gradient(180deg, #d60270 0%, #d60270 40%, #9b4f96 50%, #0038a8 60%, #0038a8 100%)",
    primaryColor: "#d60270",
    accentColor: "#0038a8",
    textColor: "#ffffff",
    bgColor: "#fdf2f8"
  },
  {
    id: "pansexual",
    name: "Pansexual",
    gradient: "linear-gradient(180deg, #ff218c 0%, #ff218c 33.33%, #ffd800 33.33%, #ffd800 66.67%, #21b1ff 66.67%, #21b1ff 100%)",
    primaryColor: "#ff218c",
    accentColor: "#21b1ff",
    textColor: "#ffffff",
    bgColor: "#fff9fb"
  },
  {
    id: "transgender",
    name: "Transgender",
    gradient: "linear-gradient(180deg, #5bcffb 0%, #5bcffb 20%, #f5abb9 20%, #f5abb9 40%, #ffffff 40%, #ffffff 60%, #f5abb9 60%, #f5abb9 80%, #5bcffb 80%, #5bcffb 100%)",
    primaryColor: "#5bcffb",
    accentColor: "#f5abb9",
    textColor: "#ffffff",
    bgColor: "#f0f9ff"
  },
  {
    id: "nonbinary",
    name: "Nonbinary",
    gradient: "linear-gradient(180deg, #fff430 0%, #fff430 25%, #ffffff 25%, #ffffff 50%, #9c59d1 50%, #9c59d1 75%, #2c2c2c 75%, #2c2c2c 100%)",
    primaryColor: "#fff430",
    accentColor: "#9c59d1",
    textColor: "#2c2c2c",
    bgColor: "#fffef0"
  },
  {
    id: "genderfluid",
    name: "Genderfluid",
    gradient: "linear-gradient(180deg, #ff76a4 0%, #ff76a4 20%, #ffffff 20%, #ffffff 40%, #c011d7 40%, #c011d7 60%, #2f2f2f 60%, #2f2f2f 80%, #2f3cbe 80%, #2f3cbe 100%)",
    primaryColor: "#ff76a4",
    accentColor: "#2f3cbe",
    textColor: "#ffffff",
    bgColor: "#fff5f9"
  },
  {
    id: "asexual",
    name: "Asexual",
    gradient: "linear-gradient(180deg, #000000 0%, #000000 25%, #a3a3a3 25%, #a3a3a3 50%, #ffffff 50%, #ffffff 75%, #800080 75%, #800080 100%)",
    primaryColor: "#800080",
    accentColor: "#000000",
    textColor: "#ffffff",
    bgColor: "#faf5ff"
  },
  {
    id: "demisexual",
    name: "Demisexual",
    gradient: "linear-gradient(180deg, #ffffff 0%, #ffffff 25%, #6e0070 25%, #6e0070 50%, #d3d3d3 50%, #d3d3d3 75%, #000000 75%, #000000 100%)",
    primaryColor: "#6e0070",
    accentColor: "#000000",
    textColor: "#ffffff",
    bgColor: "#faf5ff"
  },
  {
    id: "aromantic",
    name: "Aromantic",
    gradient: "linear-gradient(180deg, #3da542 0%, #3da542 20%, #a7d379 20%, #a7d379 40%, #ffffff 40%, #ffffff 60%, #a9a9a9 60%, #a9a9a9 80%, #000000 80%, #000000 100%)",
    primaryColor: "#3da542",
    accentColor: "#000000",
    textColor: "#ffffff",
    bgColor: "#f0fdf4"
  },
  {
    id: "genderqueer",
    name: "Genderqueer",
    gradient: "linear-gradient(180deg, #b57edc 0%, #b57edc 33.33%, #ffffff 33.33%, #ffffff 66.67%, #4a8123 66.67%, #4a8123 100%)",
    primaryColor: "#b57edc",
    accentColor: "#4a8123",
    textColor: "#ffffff",
    bgColor: "#faf5ff"
  },
  {
    id: "agender",
    name: "Agender",
    gradient: "linear-gradient(180deg, #000000 0%, #000000 14.29%, #b9b9b9 14.29%, #b9b9b9 28.57%, #ffffff 28.57%, #ffffff 42.86%, #b8f483 42.86%, #b8f483 57.14%, #ffffff 57.14%, #ffffff 71.43%, #b9b9b9 71.43%, #b9b9b9 85.71%, #000000 85.71%, #000000 100%)",
    primaryColor: "#b8f483",
    accentColor: "#000000",
    textColor: "#000000",
    bgColor: "#f9fafb"
  },
  {
    id: "polysexual",
    name: "Polysexual",
    gradient: "linear-gradient(180deg, #f61cb9 0%, #f61cb9 33.33%, #07d569 33.33%, #07d569 66.67%, #1c92f6 66.67%, #1c92f6 100%)",
    primaryColor: "#f61cb9",
    accentColor: "#1c92f6",
    textColor: "#ffffff",
    bgColor: "#fff1f9"
  },
  {
    id: "omnisexual",
    name: "Omnisexual",
    gradient: "linear-gradient(180deg, #ff9bcd 0%, #ff9bcd 20%, #ff53a6 20%, #ff53a6 40%, #200044 40%, #200044 60%, #686bff 60%, #686bff 80%, #a1dbff 80%, #a1dbff 100%)",
    primaryColor: "#ff53a6",
    accentColor: "#200044",
    textColor: "#ffffff",
    bgColor: "#fff5f9"
  },
  
  // Dark modes
  {
    id: "dark-red",
    name: "Dark Red",
    gradient: "linear-gradient(135deg, #7f1d1d 0%, #450a0a 100%)",
    primaryColor: "#7f1d1d",
    accentColor: "#450a0a",
    textColor: "#ffffff",
    bgColor: "#1f2937"
  },
  {
    id: "dark-blue",
    name: "Dark Blue",
    gradient: "linear-gradient(135deg, #1e3a8a 0%, #0c1e47 100%)",
    primaryColor: "#1e3a8a",
    accentColor: "#0c1e47",
    textColor: "#ffffff",
    bgColor: "#1f2937"
  },
  {
    id: "dark-purple",
    name: "Dark Purple",
    gradient: "linear-gradient(135deg, #581c87 0%, #3b0764 100%)",
    primaryColor: "#581c87",
    accentColor: "#3b0764",
    textColor: "#ffffff",
    bgColor: "#1f2937"
  },
];

export function getTheme(themeId: string): Theme {
  return themes.find(t => t.id === themeId) || themes[0];
}

export function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;

  const softPrimary = theme.primaryColor.length === 7 ? `${theme.primaryColor}22` : theme.primaryColor;
  const softAccent = theme.accentColor.length === 7 ? `${theme.accentColor}22` : theme.accentColor;
  const pageGradient = `linear-gradient(140deg, ${softPrimary} 0%, ${softAccent} 45%, #f8fafc 100%)`;
  const surfaceColor = `color-mix(in srgb, ${theme.bgColor} 82%, white 18%)`;
  const surfaceRaisedColor = `color-mix(in srgb, ${theme.bgColor} 70%, white 30%)`;
  const borderColor = `color-mix(in srgb, ${theme.primaryColor} 18%, #d1d5db 82%)`;
  
  document.documentElement.style.setProperty('--primary-color', theme.primaryColor);
  document.documentElement.style.setProperty('--accent-color', theme.accentColor);
  document.documentElement.style.setProperty('--primary-gradient', theme.gradient);
  document.documentElement.style.setProperty('--theme-text', theme.textColor);
  document.documentElement.style.setProperty('--theme-bg', theme.bgColor);
  document.documentElement.style.setProperty('--theme-page-gradient', pageGradient);
  document.documentElement.style.setProperty('--theme-surface', surfaceColor);
  document.documentElement.style.setProperty('--theme-surface-raised', surfaceRaisedColor);
  document.documentElement.style.setProperty('--theme-border', borderColor);
}

export function saveTheme(userId: string, themeId: string) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(`theme-${userId}`, themeId);
}

export function loadTheme(userId: string): string {
  if (typeof localStorage === 'undefined') return 'default';
  return localStorage.getItem(`theme-${userId}`) || 'default';
}
