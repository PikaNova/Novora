import assert from 'node:assert/strict';
import test from 'node:test';

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
  get length(): number {
    return this.values.size;
  }
  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }
}

const testGlobals = globalThis as typeof globalThis & { localStorage?: MemoryStorage };
testGlobals.localStorage = new MemoryStorage();

const {
  __resetExamSaveMetricsForTests,
  examSaveMetricsContext,
  getExamSaveMetrics,
  percentile,
  recordExamSave,
  recordExamSaveConflict,
} = await import('../src/services/examSaveMetrics.js');

test('保存指标：分别累计提交、跳过、字节数与域名分布', () => {
  __resetExamSaveMetricsForTests();
  recordExamSave({ domains: ['classes'], bytes: 4_000, skipped: false });
  recordExamSave({ domains: ['majors', 'items', 'title', 'activeMajorId'], bytes: 5_000, skipped: false });
  recordExamSave({ domains: ['classes'], bytes: 4_000, skipped: false });
  recordExamSave({ domains: [], bytes: 0, skipped: true });

  const metrics = getExamSaveMetrics();
  assert.equal(metrics.submits, 3);
  assert.equal(metrics.skipped, 1);
  assert.equal(metrics.bytesTotal, 13_000);
  assert.equal(metrics.bytesLast, 4_000);
  assert.equal(metrics.bytesMax, 5_000);
  assert.deepEqual(metrics.bytesSamples, [4_000, 5_000, 4_000]);
  assert.deepEqual(metrics.domains, { classes: 2, majors: 1, items: 1, title: 1, activeMajorId: 1 });
});

test('保存指标：冲突按域累计，老服务端不带 conflicts 时记 unspecified', () => {
  __resetExamSaveMetricsForTests();
  recordExamSaveConflict(['classes']);
  recordExamSaveConflict(['classes', 'weekly']);
  recordExamSaveConflict([]);

  const metrics = getExamSaveMetrics();
  assert.equal(metrics.conflicts, 3);
  assert.deepEqual(metrics.conflictDomains, { classes: 2, weekly: 1, unspecified: 1 });
});

test('保存指标：percentile 取最近样本的分位，空样本为 0', () => {
  assert.equal(percentile([], 95), 0);
  assert.equal(percentile([1, 2, 3, 4, 5], 50), 3);
  assert.equal(percentile([1, 2, 3, 4, 5], 95), 5);
});

test('保存指标：上报用的扁平静态键值只含计数、域名与字节分位', () => {
  __resetExamSaveMetricsForTests();
  recordExamSave({ domains: ['classes'], bytes: 4_000, skipped: false });
  recordExamSave({ domains: ['weeklyPlans'], bytes: 56_000, skipped: false });
  recordExamSave({ domains: [], bytes: 0, skipped: true });
  recordExamSaveConflict(['classes']);

  const context = examSaveMetricsContext();
  assert.equal(context.saveSubmits, 2);
  assert.equal(context.saveSkipped, 1);
  assert.equal(context.saveConflicts, 1);
  assert.equal(context.saveBytesAvg, 30_000);
  assert.equal(context.saveBytesP95, 56_000);
  assert.equal(context.saveBytesMax, 56_000);
  assert.match(String(context.saveDomainsTop), /classes|weeklyPlans/);
  assert.equal(context.saveConflictDomainsTop, 'classes:1');
});

test('保存指标：存储损坏时退化为全零，不影响保存路径', () => {
  testGlobals.localStorage?.setItem('novora_exam_save_metrics_v1', '{not json');
  assert.deepEqual(getExamSaveMetrics().submits, 0);
  assert.deepEqual(getExamSaveMetrics().domains, {});
  __resetExamSaveMetricsForTests();
  assert.equal(getExamSaveMetrics().submits, 0);
});
