"use client";

import { createContext, useContext, useEffect, useState } from "react";

type AnalyticsNotesContextValue = {
  autoExpandNotes: boolean;
  setAutoExpandNotes: (value: boolean) => void;
};

const AnalyticsNotesContext = createContext<AnalyticsNotesContextValue | null>(null);

export function AnalyticsNotesProvider({ children }: { children: React.ReactNode }) {
  const [autoExpandNotes, setAutoExpandNotes] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem("analytics-notes-auto-expand");
    if (saved !== null) setAutoExpandNotes(saved === "true");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("analytics-notes-auto-expand", String(autoExpandNotes));
  }, [autoExpandNotes]);

  return (
    <AnalyticsNotesContext.Provider value={{ autoExpandNotes, setAutoExpandNotes }}>
      {children}
    </AnalyticsNotesContext.Provider>
  );
}

export function useAnalyticsNotesSettings() {
  const ctx = useContext(AnalyticsNotesContext);
  if (!ctx) {
    return { autoExpandNotes: false, setAutoExpandNotes: () => {} };
  }
  return ctx;
}
