"use client";

import { useEffect } from "react";
import { BRAND } from "@/config/brand";

/** Sets the browser tab title to `<title> | <product>` while the page is open, and puts the previous one back when it closes. */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const previous = document.title;
    document.title = title ? `${title} | ${BRAND.title}` : previous;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
