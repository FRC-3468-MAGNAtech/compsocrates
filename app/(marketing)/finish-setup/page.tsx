"use client";

import { useEffect } from "react";
import { useRouter } from "@/lib/program/navigation";

/**
 * The old address of the team setup screen. It now lives at `/<program>/apply-to-team`, the same place for every program; this keeps old links, emails
 * and bookmarks working by sending them there (for the program last used).
 */
export default function FinishSetupPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/apply-to-team");
  }, [router]);
  return null;
}
