"use client";

import { useEffect } from "react";
import { useAuth } from "@/app/AuthContext";
import { applyTheme, getTheme, saveTheme } from "@/app/utils/themes";

export default function ThemeInitializer() {
  const { userData } = useAuth();

  useEffect(() => {
    applyTheme(getTheme("default", userData?.uid));
    if (userData?.uid) {
      saveTheme(userData.uid, "default");
    }
  }, [userData?.uid]);

  return null;
}
