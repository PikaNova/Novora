import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

Object.assign(globalThis, { __APP_VERSION__: 'test', __COMMIT_SHA__: 'test' });
const { default: BackupRestoreSection } = await import('../src/components/settings/BackupRestoreSection.js');

test('backup settings displays records across modes and only allows downloads where files are stored', async (t) => {
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
  const fileSha256 = createHash('sha256').update(content).digest('hex');
  let mode = 'local';
  let schedulerReady = true;
  let previewMode = false;
  const restoreRequests: Record<string, unknown>[] = [];
  const downloadedIds: string[] = [];
  const completedDownloads: Record<string, unknown>[] = [];
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
        filename:
          mode === 'windows'
            ? `novora-${id}.dump`
            : mode === 'vercel'
              ? `novora-backup-${id}.novora-backup`
              : `${id}.novora-backup`,
        fileSha256,
      });
    }
    if (init?.method === 'POST') {
      const payload = JSON.parse(String(init.body));
      if (mode === 'vercel' && payload.action === 'create')
        return Response.json({
          ok: true,
          id: '3f456d23-dc88-4954-ad88-9b5fc77f3c70',
          fileSha256,
          filename: 'novora-backup-3f456d23-dc88-4954-ad88-9b5fc77f3c70.novora-backup',
        });
      if (mode === 'vercel' && payload.action === 'downloadComplete') {
        completedDownloads.push(payload);
        return Response.json({ ok: true });
      }
      if (previewMode && payload.action === 'preview')
        return Response.json({
          ok: true,
          checksum: 'a'.repeat(64),
          fileSha256: createHash('sha256').update('backup').digest('hex'),
          bytes: 1234,
          createdAt: 1234,
          tables: [
            { table: 'app_users', rows: 2 },
            { table: 'exam_records', rows: 8 },
            { table: 'exam_announcements', rows: 1 },
          ],
          administrators: ['校务管理员'],
        });
      if (previewMode && payload.action === 'restore') restoreRequests.push(payload);
      else configs.push(payload);
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
              for (let attempt = 0; attempt < 50 && downloads.length < count + 2; attempt++)
                await new Promise<void>((resolve) => originalTimer(resolve, 5));
            });
            assert.equal(downloads.length, count + 2);
            const download = downloads.at(-2)!;
            assert.deepEqual(Buffer.from(await download.blob.arrayBuffer()), content);
            assert.match(download.filename, mode === 'windows' ? /^novora-.*\.dump$/ : /\.novora-backup$/);
            const sidecar = downloads.at(-1)!;
            assert.equal(sidecar.filename, `${download.filename}.sha256`);
            assert.equal(
              Buffer.from(await sidecar.blob.arrayBuffer()).toString(),
              `${fileSha256}  ${download.filename}\n`,
            );
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
    await t.test('Vercel downloads once and keeps a non-downloadable history record', async () => {
      mode = 'vercel';
      const count = downloads.length;
      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = TestRenderer.create(React.createElement(BackupRestoreSection, { onRestored() {} }));
      });
      try {
        assert.equal(renderer.root.findAllByProps({ 'aria-label': '下载备份' }).length, 0);
        assert.equal(renderer.root.findAllByProps({ className: 'set-backup__run-info' }).length, 4);
        assert.equal(renderer.root.findAllByProps({ 'aria-label': '删除备份记录' }).length, 4);
        assert.deepEqual(
          renderer.root.findAllByType('strong').map((node) => node.children.join('')),
          ['手动备份', '自动备份', '恢复前保护备份', '手动备份'],
        );
        assert.ok(renderer.root.findAllByType('p').some((node) => node.children.join('').includes('不提供再次下载')));
        const createButton = renderer.root
          .findAllByType('button')
          .find((button) => button.children.includes('生成并下载备份'))!;
        await act(async () => {
          createButton.props.onClick();
          for (let attempt = 0; attempt < 100 && downloads.length < count + 2; attempt++)
            await new Promise<void>((resolve) => originalTimer(resolve, 5));
        });
        assert.equal(downloads.length, count + 2);
        assert.equal(downloads[count].filename, 'novora-backup-3f456d23-dc88-4954-ad88-9b5fc77f3c70.novora-backup');
        assert.equal(downloads[count + 1].filename, `${downloads[count].filename}.sha256`);
        assert.deepEqual(completedDownloads.at(-1), {
          action: 'downloadComplete',
          id: '3f456d23-dc88-4954-ad88-9b5fc77f3c70',
          fileSha256,
        });
      } finally {
        act(() => renderer.unmount());
      }
    });
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
        act(() => checkbox.props.onChange(false));
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
    await t.test('restore flow previews business content and confirms before replacing data', async () => {
      mode = 'local';
      schedulerReady = true;
      previewMode = true;
      restoreRequests.length = 0;
      let restored = false;
      const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
      const dialogTitles: string[] = [];
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: {
          dispatchEvent(event: CustomEvent<{ title: string; resolve: (confirmed: boolean) => void }>) {
            dialogTitles.push(event.detail.title);
            event.detail.resolve(true);
            return true;
          },
        },
      });
      let renderer!: TestRenderer.ReactTestRenderer;
      try {
        await act(async () => {
          renderer = TestRenderer.create(
            React.createElement(BackupRestoreSection, {
              onRestored() {
                restored = true;
              },
            }),
          );
        });
        const picker = renderer.root.findByProps({ id: 'backup-file-input' });
        const file = new File([Buffer.from('backup')], 'school-backup.novora-backup');
        await act(async () => {
          picker.props.onChange({ currentTarget: { value: '', files: [file] }, target: { files: [file] } });
        });
        const previews = renderer.root.findAllByProps({ className: 'set-backup__contents' });
        assert.equal(
          previews.length,
          1,
          renderer.root
            .findAllByProps({ role: 'alert' })
            .map((node) => node.children.join(''))
            .join('; '),
        );
        const preview = previews[0];
        const contentText = preview.findAllByType('li').map((item) => item.children[0]);
        assert.deepEqual(contentText, ['管理员账号', '考试记录', '考试公告']);
        assert.equal(
          preview.findAll((node) =>
            ['app_users', 'exam_records', 'exam_announcements'].includes(String(node.children[0] ?? '')),
          ).length,
          0,
        );

        const password = renderer.root.findByProps({ 'aria-label': '当前超级管理员密码' });
        const confirmation = renderer.root.findByProps({ 'aria-label': '输入 RESTORE 确认恢复' });
        act(() => password.props.onChange({ target: { value: 'current-password' } }));
        act(() => confirmation.props.onChange({ target: { value: 'RESTORE' } }));
        const button = renderer.root.findAllByType('button').find((item) => item.children.includes('确认恢复'))!;
        await act(async () => {
          button.props.onClick();
          for (let attempt = 0; attempt < 50 && !restoreRequests.length; attempt++)
            await new Promise((resolve) => originalTimer(resolve, 5));
        });
        assert.equal(restoreRequests.at(-1)?.password, 'current-password');
        assert.equal(restoreRequests.at(-1)?.confirm, 'RESTORE');
        assert.deepEqual(dialogTitles, ['确认恢复备份', '恢复完成']);
        assert.equal(restored, true);
      } finally {
        act(() => renderer.unmount());
        if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
        else Reflect.deleteProperty(globalThis, 'window');
        previewMode = false;
      }
    });
  } finally {
    for (const timer of timers) clearTimeout(timer);
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});
