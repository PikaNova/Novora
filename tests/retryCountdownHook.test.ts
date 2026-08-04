import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { useRetryCountdown } from '../src/hooks/useRetryCountdown.js';

test('retry countdown exposes a future deadline on the first rerender', () => {
  const observed: number[] = [];

  function Probe({ lockedUntil }: { lockedUntil: number | null }) {
    observed.push(useRetryCountdown(lockedUntil));
    return null;
  }

  let renderer: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(Probe, { lockedUntil: null }));
  });

  const firstLockedRender = observed.length;
  act(() => {
    renderer.update(React.createElement(Probe, { lockedUntil: Date.now() + 5_000 }));
  });

  assert.ok(observed[firstLockedRender] >= 4, `expected an immediate countdown, got ${observed[firstLockedRender]}`);
  assert.ok(!observed.slice(firstLockedRender).includes(0), 'the new deadline must not render as expired before its effect runs');

  act(() => renderer.unmount());
});
