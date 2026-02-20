"use client";

import { useEffect } from "react";
import { useAuth } from "@/app/AuthContext";
import {
  applyFontPreset,
  applyTheme,
  DEFAULT_FONT_ID,
  DEFAULT_THEME_ID,
  getFontPreset,
  getTheme,
  loadLastFontPreset,
  loadLastTheme,
  loadFontPreset,
  loadTheme,
  saveFontPreset,
  saveTheme,
} from "@/app/utils/themes";

export default function ThemeInitializer() {
  const { userData, loading } = useAuth();

  useEffect(() => {
    if (loading) return;

    if (!userData?.uid) {
      const lastThemeId = loadLastTheme();
      const lastFontId = loadLastFontPreset();
      applyTheme(getTheme(lastThemeId || DEFAULT_THEME_ID));
      applyFontPreset(getFontPreset(lastFontId || DEFAULT_FONT_ID));
      return;
    }
    const selectedThemeId = loadTheme(userData.uid);
    const selectedFontId = loadFontPreset(userData.uid);
    applyTheme(getTheme(selectedThemeId, userData.uid));
    applyFontPreset(getFontPreset(selectedFontId));
    saveTheme(userData.uid, selectedThemeId || DEFAULT_THEME_ID);
    saveFontPreset(userData.uid, selectedFontId || DEFAULT_FONT_ID);
  }, [userData?.uid, loading]);

  return null;
}
