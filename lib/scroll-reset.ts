// Scroll-to-top on navigation (used by components/layout/scroll-to-top.tsx). Pure decision, so it is unit tested.

/**
 * Whether a navigation should reset the window scroll to the top.
 * - Only a change of the full pathname counts (a new page, or the same page for another program or event segment). A change of query string,
 *   filters, tabs or hash keeps the position.
 * - Browser Back / Forward (a `popstate`) keep whatever the browser restores.
 * - A URL with a hash is an in-page anchor jump: the browser scrolls to the target itself.
 */
export function shouldResetScroll(args: { prevPathname: string | null; pathname: string; traversal: boolean; hash: string }): boolean {
  const { prevPathname, pathname, traversal, hash } = args;
  if (prevPathname === null || prevPathname === pathname) return false;
  if (traversal) return false;
  if (hash && hash !== "#") return false;
  return true;
}

/** Jumps to the top at once. Never animated, so it is also what `prefers-reduced-motion` asks for. */
export function scrollToTopInstantly(win: Pick<Window, "scrollTo"> = window): void {
  win.scrollTo({ top: 0, left: 0, behavior: "instant" });
}
