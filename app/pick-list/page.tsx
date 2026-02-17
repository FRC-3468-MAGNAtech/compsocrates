"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function PickListRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/analytics/pick-list");
  }, [router]);

  return null;
}
