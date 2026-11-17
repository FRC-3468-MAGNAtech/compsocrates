"use client";

import { useMemo } from "react";
import { useProgram } from "@/lib/program/context";
import { normalizeEntries } from "@/lib/sidebar/layout";
import { useSidebarConfig } from "@/lib/sidebar/store";
import { accessPageGroups, type AccessPageGroup } from "@/lib/page-access/page-list";

/** The pages of the active program, grouped like the team's sidebar (the one registry the sidebar resolver reads). The program is data only. */
export function useAccessPageGroups(): AccessPageGroup[] {
  const program = useProgram();
  const { config } = useSidebarConfig();
  return useMemo(() => accessPageGroups(program, normalizeEntries(config)), [program, config]);
}
