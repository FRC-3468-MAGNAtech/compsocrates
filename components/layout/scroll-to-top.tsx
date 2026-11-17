"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
// The raw next/navigation hook on purpose: the program segment is part of the path here, so a program switch counts as a new page.
import { usePathname } from "next/navigation";
import { scrollToTopInstantly, shouldResetScroll } from "@/lib/scroll-reset";

/**
 * One place that makes a new route start at the top of the page. The window is the scroller (the shell has no inner overflow container); Next
 * only scrolls a new segment into view when its top is off screen, which is not enough once the shell has sticky bars, so this does it
 * explicitly. Back / Forward are left to the browser (a `popstate` marks them). Mounted once in the root layout. See lib/scroll-reset.ts.
 */
export function ScrollToTop() {
  const pathname = usePathname();
  const prev = useRef<string | null>(null);
  const traversal = useRef(false);

  useEffect(() => {
    const onPop = () => {
      traversal.current = true;
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useLayoutEffect(() => {
    if (shouldResetScroll({ prevPathname: prev.current, pathname, traversal: traversal.current, hash: window.location.hash })) {
      scrollToTopInstantly();
    }
    prev.current = pathname;
    traversal.current = false;
  }, [pathname]);

  return null;
}
