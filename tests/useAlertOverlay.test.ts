import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { useAlertOverlay, type AlertOverlayItem } from '../src/hooks/useAlertOverlay.js';
import { DEFAULT_ALERTS, type AlertsSettings } from '../src/utils/appSettings.js';
import type { ExamNotification } from '../src/hooks/useExamNotify.js';
import type { ExamItem } from '../src/types/index.js';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
  clear(): void {
    this.values.clear();
  }
}

const exam: ExamItem = {
  id: 'exam-1',
  name: 'Language',
  startTime: '2026-08-30T09:00',
  endTime: '2026-08-30T10:30',
  enabled: true,
  order: 0,
};

const nextExam: ExamItem = {
  id: 'exam-2',
  name: 'Mathematics',
  startTime: '2026-08-30T11:00',
  endTime: '2026-08-30T12:00',
  enabled: true,
  order: 1,
};

const notification: ExamNotification = {
  phase: 'ended',
  level: 'success',
  title: '考试结束',
  message: '考试已结束',
  color: '#2e7d32',
  icon: 'check',
  durationMs: 1000,
  exam,
  id: 'exam-1_ended_time',
};

test('useAlertOverlay: a notification driver becomes a timed overlay item', () => {
  const observed: Array<AlertOverlayItem | null> = [];
  const settings: AlertsSettings = { ...DEFAULT_ALERTS, durationSec: 3 };

  function Probe({ input }: { input: Parameters<typeof useAlertOverlay>[0] }) {
    observed.push(useAlertOverlay(input));
    return null;
  }

  let renderer: TestRenderer.ReactTestRenderer | undefined;
  Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true });
  try {
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(Probe, {
          input: { notification, currentExam: exam, nextExam, settings, masterTitle: 'Exam' },
        }),
      );
    });

    const shown = observed.find(Boolean);
    assert.ok(shown, 'the ended notification should enqueue an overlay');
    assert.equal(shown?.state, 'ended');
    assert.equal(shown?.examLine.includes('Language'), true);
  } finally {
    act(() => renderer?.unmount());
  }
});
