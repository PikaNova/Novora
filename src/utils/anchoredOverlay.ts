export interface OverlayRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface OverlayViewport {
  width: number;
  height: number;
}

export interface AnchoredOverlayPosition {
  left: number;
  top: number;
  maxWidth: number;
  maxHeight: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

function visibleBounds(viewport: OverlayViewport, boundary: OverlayRect | undefined, edge: number) {
  const viewportBounds = {
    left: edge,
    top: edge,
    right: Math.max(edge, viewport.width - edge),
    bottom: Math.max(edge, viewport.height - edge),
  };
  if (!boundary) return viewportBounds;
  return {
    left: Math.max(viewportBounds.left, boundary.left + edge),
    top: Math.max(viewportBounds.top, boundary.top + edge),
    right: Math.min(viewportBounds.right, boundary.left + boundary.width - edge),
    bottom: Math.min(viewportBounds.bottom, boundary.top + boundary.height - edge),
  };
}

/** Positions a portal popover inside both the viewport and an optional owner dialog. */
export function resolveAnchoredOverlayPosition({
  anchor,
  overlay,
  viewport,
  boundary,
  edge = 10,
  gap = 8,
}: {
  anchor: OverlayRect;
  overlay: Pick<OverlayRect, 'width' | 'height'>;
  viewport: OverlayViewport;
  boundary?: OverlayRect;
  edge?: number;
  gap?: number;
}): AnchoredOverlayPosition {
  let bounds = visibleBounds(viewport, boundary, edge);
  const viewportBounds = visibleBounds(viewport, undefined, edge);
  if (bounds.right <= bounds.left || bounds.bottom <= bounds.top) bounds = viewportBounds;

  const maxWidth = Math.max(1, bounds.right - bounds.left);
  const maxHeight = Math.max(1, bounds.bottom - bounds.top);
  const width = Math.min(overlay.width, maxWidth);
  const height = Math.min(overlay.height, maxHeight);
  const anchorRight = anchor.left + anchor.width;
  const anchorBottom = anchor.top + anchor.height;
  const rightSpace = bounds.right - anchorRight;
  const leftSpace = anchor.left - bounds.left;
  const belowSpace = bounds.bottom - anchorBottom;
  const aboveSpace = anchor.top - bounds.top;

  let left = rightSpace >= width + gap || rightSpace >= leftSpace
    ? anchorRight + gap
    : anchor.left - width - gap;
  let top = anchor.top + anchor.height / 2 - height / 2;

  if (rightSpace < width + gap && leftSpace < width + gap) {
    left = anchor.left + anchor.width / 2 - width / 2;
    top = belowSpace >= height || belowSpace >= aboveSpace
      ? anchorBottom + gap
      : anchor.top - height - gap;
  }

  return {
    left: clamp(left, bounds.left, Math.max(bounds.left, bounds.right - width)),
    top: clamp(top, bounds.top, Math.max(bounds.top, bounds.bottom - height)),
    maxWidth,
    maxHeight,
  };
}
