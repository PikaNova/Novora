// 双击大屏时的「退出全屏按钮」指引几何计算。
// 纯函数：输入视口、安全区、点击点与按钮矩形，输出高亮环、箭头端点与气泡位置，
// 便于单元测试固定边界收敛（翻转 / 夹取）规则。

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Rect = { left: number; top: number; width: number; height: number };
export type EdgeInsets = { top: number; right: number; bottom: number; left: number };
export type BubblePlacement = 'top' | 'bottom';

export const GUIDE_RING_PADDING = 8;
export const GUIDE_MARGIN = 12;
export const GUIDE_GAP = 14;
export const GUIDE_ARROW_GAP = 6;

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

export function isPointInside(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.left &&
    point.x <= rect.left + rect.width &&
    point.y >= rect.top &&
    point.y <= rect.top + rect.height
  );
}

/** 高亮环：按钮外扩 padding 后收敛进「视口 - 安全区 - 边距」。 */
export function ringRect(
  target: Rect,
  options: { padding?: number; viewport: Size; insets?: EdgeInsets; margin?: number },
): Rect {
  const padding = options.padding ?? GUIDE_RING_PADDING;
  const margin = options.margin ?? GUIDE_MARGIN;
  const insets = options.insets ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const minLeft = insets.left + margin;
  const minTop = insets.top + margin;
  const maxLeft = options.viewport.width - insets.right - margin - (target.width + padding * 2);
  const maxTop = options.viewport.height - insets.bottom - margin - (target.height + padding * 2);
  return {
    left: clampNumber(target.left - padding, minLeft, Math.max(minLeft, maxLeft)),
    top: clampNumber(target.top - padding, minTop, Math.max(minTop, maxTop)),
    width: target.width + padding * 2,
    height: target.height + padding * 2,
  };
}

function unitVector(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { x: 0, y: 1 };
  return { x: dx / length, y: dy / length };
}

/** 从矩形中心沿 direction 方向到矩形边界的交点。 */
export function rectEdgePoint(target: Rect, direction: Point): Point {
  const center = { x: target.left + target.width / 2, y: target.top + target.height / 2 };
  const halfWidth = target.width / 2;
  const halfHeight = target.height / 2;
  const sx = direction.x === 0 ? Number.POSITIVE_INFINITY : halfWidth / Math.abs(direction.x);
  const sy = direction.y === 0 ? Number.POSITIVE_INFINITY : halfHeight / Math.abs(direction.y);
  const scale = Math.min(sx, sy);
  if (!Number.isFinite(scale)) return center;
  return { x: center.x + direction.x * scale, y: center.y + direction.y * scale };
}

/**
 * 箭头：从点击点指向按钮最近的一条边。
 * 终点退到按钮外 GUIDE_ARROW_GAP，避免箭头压在按钮上；两者过近时不再外退，防止反向。
 */
export function arrowLine(
  start: Point,
  target: Rect,
  options: { gap?: number } = {},
): { from: Point; to: Point; direction: Point } {
  const gap = options.gap ?? GUIDE_ARROW_GAP;
  const center = { x: target.left + target.width / 2, y: target.top + target.height / 2 };
  // 取「中心 → 点击点」方向上的边，也就是离点击点最近的那条边。
  const toStart = unitVector(center, start);
  const edge = rectEdgePoint(target, toStart);
  const distance = Math.hypot(edge.x - start.x, edge.y - start.y);
  const effectiveGap = distance > gap * 2 ? gap : 0;
  const to = { x: edge.x + toStart.x * effectiveGap, y: edge.y + toStart.y * effectiveGap };
  return { from: start, to, direction: unitVector(start, to) };
}

/**
 * 气泡：默认放在点击点下方，底部空间不足时翻到上方；水平方向夹在安全区内。
 */
export function placeBubble(
  anchor: Point,
  bubble: Size,
  options: { viewport: Size; insets?: EdgeInsets; margin?: number; gap?: number; prefer?: BubblePlacement },
): { left: number; top: number; placement: BubblePlacement } {
  const margin = options.margin ?? GUIDE_MARGIN;
  const gap = options.gap ?? GUIDE_GAP;
  const insets = options.insets ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const minLeft = insets.left + margin;
  const maxLeft = options.viewport.width - insets.right - margin - bubble.width;
  const minTop = insets.top + margin;
  const maxTop = options.viewport.height - insets.bottom - margin - bubble.height;
  const below = anchor.y + gap;
  const above = anchor.y - gap - bubble.height;
  const prefer = options.prefer ?? 'bottom';
  const fitsBelow = below <= maxTop;
  const fitsAbove = above >= minTop;
  let placement: BubblePlacement = prefer;
  if (prefer === 'bottom' && !fitsBelow && fitsAbove) placement = 'top';
  else if (prefer === 'top' && !fitsAbove && fitsBelow) placement = 'bottom';
  else if (!fitsBelow && !fitsAbove) placement = below <= options.viewport.height - anchor.y ? prefer : 'top';
  const top = placement === 'bottom' ? below : above;
  return {
    left: clampNumber(anchor.x - bubble.width / 2, minLeft, Math.max(minLeft, maxLeft)),
    top: clampNumber(top, minTop, Math.max(minTop, maxTop)),
    placement,
  };
}
