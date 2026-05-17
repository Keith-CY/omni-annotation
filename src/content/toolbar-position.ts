export type SelectionAnchorRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export type ToolbarSize = {
  width: number;
  height: number;
};

export type ViewportSize = {
  width: number;
  height: number;
};

const VIEWPORT_MARGIN = 8;

export function positionToolbarForSelection(
  rect: SelectionAnchorRect,
  toolbar: ToolbarSize,
  viewport: ViewportSize
): { left: number; top: number } {
  const preferredTop = rect.top - toolbar.height - VIEWPORT_MARGIN;
  const fallbackTop = rect.bottom + VIEWPORT_MARGIN;
  const top =
    preferredTop >= VIEWPORT_MARGIN
      ? preferredTop
      : Math.min(fallbackTop, Math.max(VIEWPORT_MARGIN, viewport.height - toolbar.height - VIEWPORT_MARGIN));

  const centeredLeft = rect.left + rect.width / 2 - toolbar.width / 2;
  const left = clamp(centeredLeft, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, viewport.width - toolbar.width - VIEWPORT_MARGIN));

  return {
    left: Math.round(left),
    top: Math.round(top)
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
