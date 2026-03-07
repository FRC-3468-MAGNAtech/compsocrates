"use client";

import { useEffect } from "react";
import { useAuth } from "@/app/AuthContext";
import {
  applyFontPreset,
  applyTheme,
  clearFontPresetOverride,
  clearThemeOverride,
  DEFAULT_FONT_ID,
  DEFAULT_THEME_ID,
  getFontPreset,
  getTheme,
  loadAccountFontCache,
  loadAccountThemeCache,
  loadFontPresetOverride,
  loadLastFontPreset,
  loadLastTheme,
  loadThemeOverride,
  saveAccountFontCache,
  saveAccountThemeCache,
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

    const accountThemeId =
      String(userData.accountThemeId || "").trim() ||
      loadAccountThemeCache(userData.uid) ||
      DEFAULT_THEME_ID;
    const accountFontId =
      String(userData.accountFontId || "").trim() ||
      loadAccountFontCache(userData.uid) ||
      DEFAULT_FONT_ID;

    const themeOverrideId = loadThemeOverride(userData.uid);
    const fontOverrideId = loadFontPresetOverride(userData.uid);
    const selectedThemeId = themeOverrideId || accountThemeId;
    const selectedFontId = fontOverrideId || accountFontId;

    applyTheme(getTheme(selectedThemeId, userData.uid));
    applyFontPreset(getFontPreset(selectedFontId));

    saveAccountThemeCache(userData.uid, accountThemeId || DEFAULT_THEME_ID);
    saveAccountFontCache(userData.uid, accountFontId || DEFAULT_FONT_ID);

    if (!themeOverrideId) clearThemeOverride(userData.uid);
    if (!fontOverrideId) clearFontPresetOverride(userData.uid);
  }, [userData?.uid, userData?.accountThemeId, userData?.accountFontId, loading]);

  return null;
}
