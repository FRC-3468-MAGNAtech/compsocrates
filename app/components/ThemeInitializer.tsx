"use client";

import { useEffect } from "react";
import { useAuth } from "@/app/AuthContext";
import { applyTheme, DEFAULT_THEME_ID, getTheme, loadTheme, saveTheme } from "@/app/utils/themes";

export default function ThemeInitializer() {
  const { userData } = useAuth();

  useEffect(() => {
    if (!userData?.uid) {
      applyTheme(getTheme(DEFAULT_THEME_ID));
      return;
    }
    const selectedThemeId = loadTheme(userData.uid);
    applyTheme(getTheme(selectedThemeId, userData.uid));
    if (!selectedThemeId) {
      saveTheme(userData.uid, DEFAULT_THEME_ID);
    }
  }, [userData?.uid]);

  return null;
}
