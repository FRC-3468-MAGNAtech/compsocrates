"use client";

import type { ReactNode } from "react";
import { ProgramSwitcher } from "@/components/program/program-switcher";

/** The frame around every "set up your team" screen, in every program: the program selector above the screen, centered in a narrow column. */
export function ProgramSetupFrame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-xl flex-col justify-center gap-4 px-4">
      <ProgramSwitcher />
      {children}
    </div>
  );
}
