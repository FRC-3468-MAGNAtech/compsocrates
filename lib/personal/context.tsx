"use client";

import { createContext, useContext } from "react";

/**
 * Is the signed-in shell in PERSONAL mode (memberships ON, the account has no team in this program)? The shell (`app/(app)/[program]/layout.tsx`) decides with
 * `resolveShellRoute` and provides the answer here, so the sidebar and the pages ask one place instead of re-deriving it. Outside the shell (and in every test that does
 * not provide it) the answer is "not personal".
 */
export type PersonalMode = { personal: boolean; isPlatformOwner: boolean };

const NOT_PERSONAL: PersonalMode = { personal: false, isPlatformOwner: false };

export const PersonalModeContext = createContext<PersonalMode>(NOT_PERSONAL);

export function usePersonalMode(): PersonalMode {
  return useContext(PersonalModeContext);
}
