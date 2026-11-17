import { childrenOf } from "@/lib/sidebar/layout";
import { FOOTER_ZONE, MAIN_ZONE, type SidebarEntry } from "@/lib/sidebar/types";

// Pure model of the drag-and-drop builder. The customizer shows the sidebar as ONE flat, vertical list (the way it looks in the sidebar): the main list, a divider
// row, then the bottom block, with a group's pages right under the group, indented. An admin drags a row up or down to reorder it, and sideways to put a page
// inside the group above it (right) or take it out (left), like a file tree. `projectDrop` turns "this row is over that row, moved this far sideways" into
// "put it in this parent at this position"; `moveEntry` (edit.ts) applies it. Nothing here touches React or dnd-kit's DOM.

/** The id of the non-draggable row that separates the main list from the bottom block. */
export const FOOTER_DIVIDER_ID = "@footer-divider";

export type FlatRow = { id: string; kind: "page" | "group" | "divider"; depth: 0 | 1; parent: string | null };

/**
 * The flat rows in display order. While a group is being dragged its pages are left out (`collapsedGroupId`): they travel with it, so they must not be drop
 * targets for it.
 */
export function flattenRows(entries: readonly SidebarEntry[], collapsedGroupId?: string | null): FlatRow[] {
  const rows: FlatRow[] = [];
  const pushZone = (zone: string | null) => {
    for (const e of childrenOf(entries, zone)) {
      rows.push({ id: e.id, kind: e.kind, depth: 0, parent: zone });
      if (e.kind !== "group" || e.id === collapsedGroupId) continue;
      for (const c of childrenOf(entries, e.id)) rows.push({ id: c.id, kind: "page", depth: 1, parent: e.id });
    }
  };
  pushZone(MAIN_ZONE);
  rows.push({ id: FOOTER_DIVIDER_ID, kind: "divider", depth: 0, parent: null });
  pushZone(FOOTER_ZONE);
  return rows;
}

export type DropProjection = {
  /** Where the dragged entry would land: a zone (`null` main list, `"@footer"`) or a group id. */
  parent: string | null;
  /** Its position among that parent's other children. */
  index: number;
  /** 1 when it lands inside a group, else 0 (what the row is drawn indented as while dragging). */
  depth: 0 | 1;
};

const move = <T,>(list: readonly T[], from: number, to: number): T[] => {
  const copy = [...list];
  copy.splice(to, 0, ...copy.splice(from, 1));
  return copy;
};

/**
 * Where a drag would land. `overId` is the row the dragged row is currently over (the dragged row's own id when it has not left its place) and `offsetX`
 * how far it has been dragged sideways, in pixels (`indentWidth` is one level). Returns null for an id that is not in the list, or for the divider.
 *
 * Rules: a group is always top-level; a page can sit inside a group only when the row right above it is that group or one of its pages; dragging a
 * level's width right asks for the inside, left for the outside. Pages dropped under the divider are in the bottom block.
 */
export function projectDrop(input: { entries: readonly SidebarEntry[]; activeId: string; overId: string; offsetX: number; indentWidth: number }): DropProjection | null {
  const { entries, activeId, overId, offsetX, indentWidth } = input;
  const active = entries.find((e) => e.id === activeId);
  if (!active) return null;
  const rows = flattenRows(entries, active.kind === "group" ? activeId : null);
  const from = rows.findIndex((r) => r.id === activeId);
  const to = rows.findIndex((r) => r.id === overId);
  if (from < 0 || to < 0) return null;
  const moved = move(rows, from, to);
  const above = moved[to - 1];
  const dividerAt = moved.findIndex((r) => r.kind === "divider");
  const zone = dividerAt >= 0 && dividerAt < to ? FOOTER_ZONE : MAIN_ZONE;

  // A page may nest under a group, or under another page of a group; everything else stays top-level.
  const canNest = active.kind === "page" && !!above && (above.kind === "group" || (above.kind === "page" && above.depth === 1));
  const wanted = rows[from].depth + Math.round(indentWidth > 0 ? offsetX / indentWidth : 0);
  const depth: 0 | 1 = canNest && wanted >= 1 ? 1 : 0;

  const parent = depth === 1 ? (above.kind === "group" ? above.id : above.parent) : zone;
  let index = 0;
  for (let i = 0; i < to; i += 1) if (moved[i].kind !== "divider" && moved[i].parent === parent) index += 1;
  return { parent, index, depth };
}
