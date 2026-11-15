// Pure placement maths for FloatingPanel (components/ui/floating-panel.tsx): where a `position: fixed` panel goes next to its anchor, clamped to the viewport.

export type FloatAlign = "start" | "center" | "end";

export type Box = { left: number; top: number; width: number; height: number };

export type PanelPosition = {
  left: number;
  top: number;
  side: "bottom" | "top";
  /** The tallest the panel may be on the side it opened: the room between the anchor and the viewport edge. The caller caps its height to this and scrolls inside. */
  maxHeight: number;
};

/**
 * Places a panel of `panel` size under `anchor` (aligned to its start, centre or end edge). If it does not fit below but there is more room above,
 * it opens above. The result is always clamped so the panel stays `margin` px inside the viewport (a panel taller than the space is pinned to the
 * margin; the caller caps its height to `maxHeight` and scrolls inside).
 */
export function computePanelPosition(args: {
  anchor: Box;
  panel: { width: number; height: number };
  viewport: { width: number; height: number };
  align?: FloatAlign;
  offset?: number;
  margin?: number;
}): PanelPosition {
  const { anchor, panel, viewport, align = "start", offset = 8, margin = 8 } = args;

  let left = anchor.left;
  if (align === "end") left = anchor.left + anchor.width - panel.width;
  else if (align === "center") left = anchor.left + anchor.width / 2 - panel.width / 2;
  left = Math.max(margin, Math.min(left, viewport.width - panel.width - margin));

  const below = anchor.top + anchor.height + offset;
  const spaceBelow = viewport.height - below - margin;
  const spaceAbove = anchor.top - offset - margin;
  const flip = panel.height > spaceBelow && spaceAbove > spaceBelow;
  // The panel is shown no taller than the room on its side (never below a usable minimum, and never taller than the viewport minus margins).
  const maxHeight = Math.max(0, Math.min(flip ? spaceAbove : spaceBelow, viewport.height - 2 * margin));
  const height = Math.min(panel.height, maxHeight);
  let top = flip ? anchor.top - offset - height : below;
  top = Math.max(margin, Math.min(top, viewport.height - height - margin));

  return { left, top, side: flip ? "top" : "bottom", maxHeight };
}
