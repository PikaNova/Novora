import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DIAGNOSTIC_BUNDLE_MAX_ENTRIES,
  DIAGNOSTIC_BUNDLE_MAX_BYTES,
  splitDiagnosticParts,
  type DiagnosticLogEntry,
} from '../src/shared/diagnosticLogContracts.js';

function entry(index: number, message = `line ${index}`): DiagnosticLogEntry {
  return { at: 1_710_000_000_000 + index, level: 'info', message };
}

test('splitDiagnosticParts keeps a small bundle as a single part', () => {
  const result = splitDiagnosticParts([entry(1), entry(2), entry(3)]);
  assert.equal(result.parts.length, 1);
  assert.equal(result.parts[0].length, 3);
  assert.equal(result.truncatedCount, 0);
});

test('splitDiagnosticParts splits by entry count at the author-side limit', () => {
  const entries = Array.from({ length: DIAGNOSTIC_BUNDLE_MAX_ENTRIES + 1 }, (_, index) => entry(index));
  const result = splitDiagnosticParts(entries);
  assert.equal(result.parts.length, 2);
  assert.equal(result.parts[0].length, DIAGNOSTIC_BUNDLE_MAX_ENTRIES);
  assert.equal(result.parts[1].length, 1);
  assert.equal(result.truncatedCount, 0);
});

test('splitDiagnosticParts splits by bytes so no part exceeds the 8 MB limit', () => {
  // 每条 2000 字符：单片放不下 5000 条，必须按字节切。
  const message = 'x'.repeat(2000);
  const entries = Array.from({ length: 6000 }, (_, index) => entry(index, message));
  const result = splitDiagnosticParts(entries);
  assert.ok(result.parts.length > 1, 'expected byte-based splitting');
  const total = result.parts.reduce((sum, part) => sum + part.length, 0);
  assert.equal(total, entries.length);
  for (const part of result.parts) {
    assert.ok(Buffer.byteLength(JSON.stringify(part), 'utf8') <= DIAGNOSTIC_BUNDLE_MAX_BYTES);
  }
});

test('splitDiagnosticParts reports how many entries were dropped past the part limit', () => {
  const entries = Array.from({ length: DIAGNOSTIC_BUNDLE_MAX_ENTRIES * 2 + 1 }, (_, index) => entry(index));
  const result = splitDiagnosticParts(entries, 2);
  assert.equal(result.parts.length, 2);
  assert.equal(result.truncatedCount, 1);
});
