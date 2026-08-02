import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAnchoredOverlayPosition } from '../src/utils/anchoredOverlay.js';

const viewport = { width: 1280, height: 800 };
const overlay = { width: 292, height: 360 };

test('anchored overlay opens beside its trigger when the owner dialog has room', () => {
  const position = resolveAnchoredOverlayPosition({
    anchor: { left: 500, top: 260, width: 120, height: 40 },
    overlay,
    viewport,
    boundary: { left: 240, top: 120, width: 800, height: 600 },
  });
  assert.equal(position.left, 628);
  assert.equal(position.top, 130);
});

test('anchored overlay flips to the left before it escapes the owner dialog', () => {
  const position = resolveAnchoredOverlayPosition({
    anchor: { left: 860, top: 300, width: 100, height: 40 },
    overlay,
    viewport,
    boundary: { left: 240, top: 120, width: 800, height: 600 },
  });
  assert.equal(position.left, 560);
  assert.equal(position.top, 140);
});

test('anchored overlay stays inside the shared viewport and dialog safety edges', () => {
  const position = resolveAnchoredOverlayPosition({
    anchor: { left: 8, top: 40, width: 50, height: 32 },
    overlay,
    viewport: { width: 300, height: 420 },
    boundary: { left: 0, top: 0, width: 300, height: 420 },
  });
  assert.equal(position.left, 10);
  assert.equal(position.top, 50);
  assert.equal(position.maxWidth, 280);
  assert.equal(position.maxHeight, 400);
});

test('right placement may use viewport space beyond the owner dialog', () => {
  const position = resolveAnchoredOverlayPosition({
    anchor: { left: 450, top: 350, width: 100, height: 48 },
    overlay,
    viewport,
    boundary: { left: 240, top: 120, width: 340, height: 600 },
    placement: 'right',
  });
  assert.equal(position.left, 558);
  assert.equal(position.top, 194);
});

test('right placement falls back above a wide custom-time prompt when the viewport cannot fit it', () => {
  const position = resolveAnchoredOverlayPosition({
    anchor: { left: 374, top: 618, width: 420, height: 88 },
    overlay,
    viewport: { width: 920, height: 960 },
    boundary: { left: 138, top: 238, width: 680, height: 678 },
    placement: 'right',
  });
  assert.equal(position.left, 438);
  assert.equal(position.top, 250);
});
