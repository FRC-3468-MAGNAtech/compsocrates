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
  loadFontPreset,
  loadTheme,
  saveFontPreset,
  saveTheme,
} from "@/app/utils/themes";

export default function ThemeInitializer() {
  const { userData } = useAuth();

  useEffect(() => {
    if (!userData?.uid) {
      applyTheme(getTheme(DEFAULT_THEME_ID));
      applyFontPreset(getFontPreset(DEFAULT_FONT_ID));
      return;
    }
    const selectedThemeId = loadTheme(userData.uid);
    const selectedFontId = loadFontPreset(userData.uid);
    applyTheme(getTheme(selectedThemeId, userData.uid));
    applyFontPreset(getFontPreset(selectedFontId));
    saveTheme(userData.uid, selectedThemeId || DEFAULT_THEME_ID);
    saveFontPreset(userData.uid, selectedFontId || DEFAULT_FONT_ID);
  }, [userData?.uid]);

  return null;
}
