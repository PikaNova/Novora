import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

Object.assign(globalThis, { __APP_VERSION__: 'test', __COMMIT_SHA__: 'test' });
const { default: BackupRestoreSection } = await import('../src/components/settings/BackupRestoreSection.js');

test('backup settings offers working downloads for every successful backup kind', async (t) => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const downloads: Array<{ filename: string; blob: Blob }> = [];
  let selectedBlob: Blob;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const originalTimer = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (fn: () => void, delay: number) => {
    const timer = originalTimer(fn, delay);
    timer.unref();
    timers.push(timer);
    return timer;
  });
  t.mock.method(URL, 'createObjectURL', (blob: Blob) => {
    selectedBlob = blob;
    return 'blob:test-backup';
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      body: { appendChild() {} },
      createElement() {
        return {
          href: '',
          download: '',
          remove() {},
          click() {
            downloads.push({ filename: this.download, blob: selectedBlob });
          },
        };
      },
    },
  });
  const content = Buffer.from('备份学校\u0000\ufffd');
  let mode = 'local';
  let schedulerReady = true;
  const downloadedIds: string[] = [];
  const configs: Record<string, unknown>[] = [];
  const kinds = ['manual', 'automatic', 'protection'];
  t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    const parsed = new URL(url, 'http://localhost');
    if (parsed.searchParams.has('file')) {
      const id = parsed.searchParams.get('file')!;
      downloadedIds.push(id);
      const part = Number(parsed.searchParams.get('part'));
      return Response.json({
        ok: true,
        total: 2,
        content: (part === 0 ? content.subarray(0, 1) : content.subarray(1)).toString('base64'),
        filename: mode === 'windows' ? `novora-${id}.dump` : `${id}.novora-backup`,
      });
    }
    if (init?.method === 'POST') {
      configs.push(JSON.parse(String(init.body)));
      return Response.json({ ok: true });
    }
    return Response.json({
      ok: true,
      mode,
      enabled: true,
      retention: 14,
      schedulerReady,
      busy: false,
      maxBytes: 20 * 1024 * 1024,
      hasMore: false,
      runs: [
        ...kinds.map((kind) => ({
          id: kind,
          kind: mode === 'windows' ? 'windows' : kind,
          status: 'success',
          created_at: 1234,
          size_bytes: content.length,
        })),
        { id: 'failed', kind: 'manual', status: 'failed', created_at: 1234, size_bytes: 0 },
      ],
    });
  });
  try {
    for (mode of ['local', 'windows']) {
      await t.test(`${mode}: all successful entries download exact bytes and preserve filenames`, async () => {
        let renderer!: TestRenderer.ReactTestRenderer;
        await act(async () => {
          renderer = TestRenderer.create(React.createElement(BackupRestoreSection, { onRestored() {} }));
        });
        try {
          const buttons = renderer.root.findAllByProps({ 'aria-label': '下载备份' });
          assert.equal(buttons.length, 3, 'failed entries must not expose a download');
          for (const button of buttons) {
            const count = downloads.length;
            await act(async () => {
              button.props.onClick();
              for (let attempt = 0; attempt < 50 && downloads.length === count; attempt++)
                await new Promise<void>((resolve) => originalTimer(resolve, 5));
            });
            assert.equal(downloads.length, count + 1);
            const download = downloads.at(-1)!;
            assert.deepEqual(Buffer.from(await download.blob.arrayBuffer()), content);
            assert.match(download.filename, mode === 'windows' ? /^novora-.*\.dump$/ : /\.novora-backup$/);
          }
          if (mode === 'windows') {
            assert.equal(renderer.root.findAllByProps({ id: 'backup-automatic' }).length, 0);
            assert.equal(renderer.root.findAllByProps({ 'aria-label': '删除备份' }).length, 0);
          }
        } finally {
          act(() => renderer.unmount());
        }
      });
    }
    assert.deepEqual(
      downloadedIds,
      [...kinds, ...kinds].flatMap((kind) => [kind, kind]),
    );
    await t.test('automatic backup can be disabled after scheduler configuration is removed', async () => {
      mode = 'local';
      schedulerReady = false;
      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = TestRenderer.create(React.createElement(BackupRestoreSection, { onRestored() {} }));
      });
      try {
        const checkbox = renderer.root.findByProps({ id: 'backup-automatic' });
        assert.equal(checkbox.props.disabled, false);
        act(() => checkbox.props.onChange({ target: { checked: false } }));
        const save = renderer.root.findAllByType('button').find((button) => button.children.includes('保存'))!;
        assert.equal(save.props.disabled, false);
        await act(async () => {
          await save.props.onClick();
        });
        assert.equal(configs.at(-1)?.enabled, false);
      } finally {
        act(() => renderer.unmount());
      }
    });
  } finally {
    for (const timer of timers) clearTimeout(timer);
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});
