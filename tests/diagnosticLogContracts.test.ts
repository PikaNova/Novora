import assert from 'node:assert/strict';
import test from 'node:test';
import {
  sanitizeDiagnosticContext,
  sanitizeDiagnosticEntry,
  sanitizeDiagnosticMessage,
} from '../src/shared/diagnosticLogContracts.js';

test('diagnostic messages remove credentials and school business values', () => {
  const value = sanitizeDiagnosticMessage(
    'Authorization: Bearer secret examTitle=期中考试 studentId=001 request failed',
  );
  assert.ok(value.includes('<redacted>'));
  assert.ok(!value.includes('secret'));
  assert.ok(!value.includes('期中考试'));
  assert.ok(!value.includes('studentId'));
});

test('diagnostic context excludes business and secret fields', () => {
  assert.deepEqual(
    sanitizeDiagnosticContext({ operation: 'sync', requestId: 'req-1', examTitle: '期中考试', token: 'secret' }),
    {
      operation: 'sync',
      requestId: 'req-1',
    },
  );
});

test('diagnostic entries are bounded and typed', () => {
  const result = sanitizeDiagnosticEntry({
    at: 1710000000000,
    level: 'error',
    message: 'failed',
    context: { retry: 1 },
  });
  assert.deepEqual(result, {
    at: 1710000000000,
    level: 'error',
    message: 'failed',
    source: null,
    context: { retry: 1 },
  });
  assert.equal(sanitizeDiagnosticEntry({ at: 0, message: 'bad' }), null);
});
