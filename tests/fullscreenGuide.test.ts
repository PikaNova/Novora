import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GUIDE_MARGIN,
  arrowLine,
  clampNumber,
  isPointInside,
  placeBubble,
  rectEdgePoint,
  ringRect,
} from '../src/utils/fullscreenGuide.js';

const viewport = { width: 1280, height: 720 };
const mobile = { width: 390, height: 844 };
const mobileInsets = { top: 44, right: 0, bottom: 34, left: 0 };

test('clampNumber: 收敛到区间内，区间非法或非有限值时给出安全结果', () => {
  assert.equal(clampNumber(5, 0, 10), 5);
  assert.equal(clampNumber(-3, 0, 10), 0);
  assert.equal(clampNumber(99, 0, 10), 10);
  assert.equal(clampNumber(Number.NaN, 4, 10), 4);
  assert.equal(clampNumber(5, 10, 0), 10);
});

test('ringRect: 按 padding 外扩，并在贴边时收敛回视口内', () => {
  const middle = ringRect({ left: 600, top: 300, width: 40, height: 40 }, { viewport });
  assert.deepEqual(middle, { left: 592, top: 292, width: 56, height: 56 });

  const corner = ringRect({ left: 1270, top: 710, width: 40, height: 40 }, { viewport, padding: 8 });
  assert.equal(corner.left + corner.width, viewport.width - GUIDE_MARGIN);
  assert.equal(corner.top + corner.height, viewport.height - GUIDE_MARGIN);
});

test('ringRect: 移动端按安全区收敛', () => {
  const ring = ringRect(
    { left: 380, top: 830, width: 44, height: 44 },
    { viewport: mobile, insets: mobileInsets, padding: 8 },
  );
  assert.ok(ring.left >= mobileInsets.left + GUIDE_MARGIN);
  assert.ok(ring.top >= mobileInsets.top + GUIDE_MARGIN);
  assert.ok(ring.left + ring.width <= mobile.width - mobileInsets.right - GUIDE_MARGIN);
  assert.ok(ring.top + ring.height <= mobile.height - mobileInsets.bottom - GUIDE_MARGIN);
});

test('rectEdgePoint: 命中矩形最近的一条边', () => {
  const target = { left: 100, top: 100, width: 40, height: 20 };
  assert.deepEqual(rectEdgePoint(target, { x: 1, y: 0 }), { x: 140, y: 110 });
  assert.deepEqual(rectEdgePoint(target, { x: -1, y: 0 }), { x: 100, y: 110 });
  assert.deepEqual(rectEdgePoint(target, { x: 0, y: 1 }), { x: 120, y: 120 });
  assert.deepEqual(rectEdgePoint(target, { x: 0, y: -1 }), { x: 120, y: 100 });
});

test('arrowLine: 从左下方指向按钮时，终点停在按钮外沿且箭头方向朝按钮', () => {
  const target = { left: 1000, top: 40, width: 40, height: 40 };
  const start = { x: 300, y: 500 };
  const arrow = arrowLine(start, target);
  assert.deepEqual(arrow.from, start);
  assert.equal(isPointInside(arrow.to, target), false, '终点必须退到按钮之外，避免箭头压在按钮上');
  assert.ok(arrow.to.x < target.left, '按钮在点击点右侧时，终点应落在左边缘外侧');
  assert.ok(arrow.direction.x > 0.8, '方向应主要朝右');
  assert.ok(arrow.to.y >= target.top && arrow.to.y <= target.top + target.height, '终点应落在按钮的同一条边上');
});

test('arrowLine: 点击点就在按钮内时不会把箭头反向拉长', () => {
  const target = { left: 100, top: 100, width: 60, height: 60 };
  const arrow = arrowLine({ x: 130, y: 130 }, target);
  assert.ok(Number.isFinite(arrow.to.x) && Number.isFinite(arrow.to.y));
  assert.ok(Math.hypot(arrow.to.x - arrow.from.x, arrow.to.y - arrow.from.y) < 40);
});

test('placeBubble: 默认放在点击点下方，并在右侧贴边时向左收敛', () => {
  const bubble = { width: 240, height: 90 };
  const bottom = placeBubble({ x: 400, y: 200 }, bubble, { viewport });
  assert.equal(bottom.placement, 'bottom');
  assert.equal(bottom.left, 400 - 120);
  assert.equal(bottom.top, 200 + 14);

  const nearRight = placeBubble({ x: 1270, y: 200 }, bubble, { viewport });
  assert.equal(nearRight.left + bubble.width, viewport.width - GUIDE_MARGIN);
});

test('placeBubble: 底部空间不足时翻转到上方', () => {
  const bubble = { width: 240, height: 90 };
  const flipped = placeBubble({ x: 400, y: 690 }, bubble, { viewport });
  assert.equal(flipped.placement, 'top');
  assert.equal(flipped.top, 690 - 14 - 90);
});

test('placeBubble: 移动端同时满足安全区（上下都要留边）', () => {
  const bubble = { width: 300, height: 96 };
  const top = placeBubble({ x: 195, y: 60 }, bubble, {
    viewport: mobile,
    insets: mobileInsets,
    prefer: 'top',
  });
  assert.ok(top.top >= mobileInsets.top + GUIDE_MARGIN);
  assert.ok(top.left >= mobileInsets.left + GUIDE_MARGIN);
  assert.ok(top.left + bubble.width <= mobile.width - mobileInsets.right - GUIDE_MARGIN);
});

test('isPointInside: 用于判断点击点是否落在按钮上', () => {
  const rect = { left: 10, top: 10, width: 20, height: 20 };
  assert.equal(isPointInside({ x: 15, y: 15 }, rect), true);
  assert.equal(isPointInside({ x: 31, y: 15 }, rect), false);
});
