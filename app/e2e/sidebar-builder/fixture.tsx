"use client";

import { useEffect, useState } from "react";
import { SidebarPanelView } from "@/components/admin/sidebar-panel";
import { resetAll, sameLayout } from "@/lib/sidebar/edit";
import { defaultEntries, pageLabel } from "@/lib/sidebar/layout";
import type { SidebarEntry } from "@/lib/sidebar/types";

declare global {
  interface Window {
    /** What the screen asked to do, in order (for the tests): saves (with the layout) and sync requests. */
    __sb?: { type: string; entries?: SidebarEntry[] }[];
  }
}

const log = (entry: { type: string; entries?: SidebarEntry[] }) => (window.__sb ??= []).push(entry);

export function SidebarBuilderFixture() {
  const [saved, setSaved] = useState<SidebarEntry[]>(() => defaultEntries());
  const [draft, setDraft] = useState<SidebarEntry[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    window.__sb = [];
  }, []);
  const shown = draft ?? saved;
  return (
    <main className="mx-auto max-w-5xl p-4">
      <SidebarPanelView
        loaded
        loadError={null}
        entries={shown}
        program="frc"
        labelOf={pageLabel}
        dirty={draft !== null && !sameLayout(draft, saved)}
        saving={false}
        conflict={false}
        saveError={null}
        notice={notice}
        sync={{ otherName: "FTC", busy: false, message: null, onSend: () => log({ type: "send" }), onPull: () => log({ type: "pull" }) }}
        onChange={(next) => {
          setNotice(null);
          setDraft(next);
        }}
        onSave={() => {
          log({ type: "save", entries: shown });
          setSaved(shown);
          setDraft(null);
          setNotice("Saved.");
        }}
        onDiscard={() => setDraft(null)}
        onResetAll={() => setDraft(resetAll())}
        onReloadLatest={() => setDraft(null)}
      />
    </main>
  );
}
