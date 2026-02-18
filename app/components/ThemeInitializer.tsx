"use client";

import { useEffect } from "react";
import { useAuth } from "@/app/AuthContext";
import { applyTheme, getTheme, loadTheme } from "@/app/utils/themes";

export default function ThemeInitializer() {
  const { userData } = useAuth();

  useEffect(() => {
    const themeId = userData?.uid ? loadTheme(userData.uid) : "default";
    applyTheme(getTheme(themeId, userData?.uid));
  }, [userData?.uid]);

  return null;
}
