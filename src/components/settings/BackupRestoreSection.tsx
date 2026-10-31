import { useEffect, useState } from 'react';
import { apiFetch } from '../../services/auth/client';
import { clearPendingExamSync } from '../../services/examOutbox';
import { clearAuthSession } from '../../services/auth/session';
import { confirmDialog, infoDialog } from '../../services/appDialog';
import InlineSelect from '../InlineSelect';
import { Switch } from './Switch';
import { Download, Play, RefreshCw, RotateCcw, Shield, Trash2, Upload } from 'lucide-react';

type BackupRun = {
  id: string;
  kind: string;
  status: string;
  created_at: number;
  size_bytes: number;
  checksum: string;
  error: string;
  filename?: string;
  file_sha256?: string;
  fileStored?: boolean;
};
type Status = {
  mode: 'local' | 'vercel' | 'windows' | 'unconfigured';
  enabled: boolean;
  retention: number;
  schedulerReady: boolean;
  busy: boolean;
  maxBytes: number;
  runs: BackupRun[];
  hasMore: boolean;
};
type Preview = {
  uploadId: string;
  checksum: string;
  bytes: number;
  createdAt: number;
  tables: Array<{ table: string; rows: number }>;
  administrators: string[];
  filename: string;
  fileSha256: string;
};
const CHUNK = 512 * 1024;
const RETENTION_OPTIONS = Array.from({ length: 365 }, (_, index) => index + 1).map((value) => ({
  value: String(value),
  label: `${value} 份`,
}));
const CONTENT_LABELS: Record<string, string> = {
  app_roles: '角色与权限定义',
  app_users: '管理员账号',
  app_user_scopes: '账号授权范围',
  exam_data: '学校与考试基础设置',
  exam_records: '考试记录',
  exam_record_operations: '考试操作记录',
  exam_announcements: '考试公告',
  exam_announcement_images: '公告图片引用',
  exam_announcement_receipts: '公告送达回执',
  exam_announcement_templates: '公告模板',
  device_instances: '设备绑定',
  classisland_plugin_instances: '插件实例',
  app_time_control: '时间控制设置',
  app_diagnostic_settings: '诊断设置',
};
function formatSize(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}
function formatDate(at: number) {
  return new Date(at).toLocaleString();
}
function decodeBase64(text: string) {
  return Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0));
}
async function encodeBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}
async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function saveDownload(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
async function request(url: string, init?: RequestInit) {
  const response = await apiFetch(url, init, 60_000);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) throw new Error(body.error || `请求失败 (${response.status})`);
  return body;
}
export default function BackupRestoreSection({ onRestored }: { onRestored: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [automatic, setAutomatic] = useState(false);
  const [retention, setRetention] = useState(14);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busyMessage, setBusyMessage] = useState('');
  const refresh = async () => {
    const next = await request('/api/backups');
    setStatus(next);
    setAutomatic(next.enabled);
    setRetention(next.retention);
  };
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);
  const act = async (action: () => Promise<void>, reload = true, message = '正在处理，请稍候…') => {
    setBusy(true);
    setBusyMessage(message);
    setError('');
    setNotice('');
    try {
      await action();
      if (reload) await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
      setBusyMessage('');
    }
  };
  const create = () =>
    act(
      async () => {
        if (status?.mode === 'vercel') {
          const generated = await request('/api/backups', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'create' }),
          });
          await downloadTransient(generated, '备份已生成并下载');
          return;
        }
        await request('/api/backups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'create' }),
        });
      },
      true,
      status?.mode === 'vercel' ? '正在生成、校验并下载备份…' : '正在创建并保存备份…',
    );
  const saveConfig = () =>
    act(async () => {
      await request('/api/backups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'configure', enabled: automatic, retention }),
      });
    });
  const downloadContent = async (id: string, expectedSha?: string) => {
    const first = await request(`/api/backups?file=${encodeURIComponent(id)}&part=0`);
    const chunks = [decodeBase64(first.content)];
    for (let part = 1; part < first.total; part++) {
      const next = await request(`/api/backups?file=${encodeURIComponent(id)}&part=${part}`);
      chunks.push(decodeBase64(next.content));
    }
    const blob = new Blob(chunks, { type: 'application/octet-stream' });
    const fileSha256 = await sha256(blob);
    const expected = expectedSha || first.fileSha256;
    if (expected && fileSha256 !== expected) throw new Error('备份文件 SHA-256 校验失败，未下载文件');
    const filename = first.filename;
    saveDownload(filename, blob);
    saveDownload(
      `${filename}.sha256`,
      new Blob([`${fileSha256}  ${filename}\n`], { type: 'text/plain;charset=utf-8' }),
    );
    return { fileSha256, filename, checksum: first.checksum };
  };
  const downloadTransient = async (generated: { id: string; fileSha256: string; filename: string }, label: string) => {
    const downloaded = await downloadContent(generated.id, generated.fileSha256);
    await request('/api/backups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'downloadComplete', id: generated.id, fileSha256: downloaded.fileSha256 }),
    });
    setNotice(`${label}。SHA-256：${downloaded.fileSha256}`);
    return downloaded;
  };
  const download = (run: BackupRun) =>
    act(async () => {
      await downloadContent(run.id, run.file_sha256 || undefined);
    }, false);
  const remove = async (run: BackupRun) => {
    if (
      !(await confirmDialog({
        title: status?.mode === 'vercel' ? '删除备份记录' : '删除服务端备份',
        message:
          status?.mode === 'vercel'
            ? '删除后将清除云端保留的这条记录和 SHA-256 校验值。已下载到本机的文件不受影响。'
            : '删除后无法从服务端下载这份备份，已保存到本机的文件不受影响。',
        tone: 'danger',
        confirmLabel: '删除',
      }))
    )
      return;
    void act(async () => {
      await request(`/api/backups?id=${encodeURIComponent(run.id)}`, { method: 'DELETE' });
    });
  };
  const chooseFile = () => document.getElementById('backup-file-input')?.click();
  const uploadFile = async (file: File) =>
    act(
      async () => {
        setPreview(null);
        setPassword('');
        setConfirm('');
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 15) | 64;
        bytes[8] = (bytes[8] & 63) | 128;
        const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
        const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
        const total = Math.ceil(file.size / CHUNK);
        const maxBytes = status?.maxBytes ?? 20 * 1024 * 1024;
        if (!total || file.size > maxBytes) throw new Error(`文件为空或超过 ${formatSize(maxBytes)}`);
        const localFileSha256 = await sha256(file);
        for (let part = 0; part < total; part++) {
          const content = await encodeBase64(file.slice(part * CHUNK, (part + 1) * CHUNK));
          await request('/api/backups', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'upload', id, part, total, content }),
          });
        }
        const info = await request('/api/backups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'preview', uploadId: id }),
        });
        if (info.fileSha256 !== localFileSha256) throw new Error('上传文件 SHA-256 与原文件不一致');
        setPreview({ ...info, uploadId: id, filename: file.name, fileSha256: localFileSha256 });
      },
      true,
      '正在上传并校验备份文件…',
    );
  const restore = async () => {
    if (!preview || confirm !== 'RESTORE' || !password) return;
    if (
      !(await confirmDialog({
        title: '确认恢复备份',
        message:
          '恢复会替换当前学校数据和账号，并让所有会话重新登录。Vercel 会先生成并下载一份恢复前保护备份及其 SHA-256 校验文件，然后才开始恢复。',
        tone: 'danger',
        confirmLabel: '继续恢复',
      }))
    )
      return;
    void act(
      async () => {
        let protection: { id: string; checksum: string; fileSha256: string } | undefined;
        if (status?.mode === 'vercel') {
          const generated = await request('/api/backups', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'protect' }),
          });
          const downloaded = await downloadTransient(generated, '恢复前保护备份已校验并下载');
          protection = { id: generated.id, checksum: generated.checksum, fileSha256: downloaded.fileSha256 };
        }
        await request('/api/backups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'restore',
            uploadId: preview.uploadId,
            checksum: preview.checksum,
            fileSha256: preview.fileSha256,
            protectionId: protection?.id,
            protectionChecksum: protection?.checksum,
            protectionFileSha256: protection?.fileSha256,
            password,
            confirm,
          }),
        });
        setPreview(null);
        setPassword('');
        setConfirm('');
        clearPendingExamSync();
        clearAuthSession();
        await infoDialog({
          title: '恢复完成',
          message:
            status?.mode === 'vercel'
              ? '数据已恢复。恢复前保护备份及 SHA-256 校验文件已下载到本机；请使用备份中的账号重新登录。'
              : '数据已恢复，恢复前保护备份已保存，可在上方备份列表下载。请使用备份中的账号重新登录。',
          confirmLabel: '知道了',
        });
        onRestored();
      },
      false,
      '正在恢复数据，请勿关闭页面…',
    );
  };
  return (
    <section className="set-card set-backup">
      <div className="set-card__head">
        <h2 className="set-card__title">
          <Shield size={18} />
          全量备份与恢复
        </h2>
      </div>
      <p className="set-card__lead">
        备份包含学校数据、考试、公告、设备绑定与账号，不含部署密钥和运行队列。Windows 客户端继续使用原有 PostgreSQL
        .dump 备份。
      </p>
      <p className="set-note">
        备份方式：
        {status?.mode === 'vercel'
          ? 'Vercel 即时下载'
          : status?.mode === 'local'
            ? 'Linux 自部署本地目录'
            : status?.mode === 'windows'
              ? 'Windows 客户端控制中心'
              : '尚未配置'}
        。
        {status?.mode === 'windows'
          ? '备份和恢复请使用控制中心。'
          : status?.mode === 'vercel'
            ? '立即生成并下载备份文件和 SHA-256 校验文件；历史记录仅保留生成时间、大小和校验值，不提供再次下载。'
            : status?.mode === 'local'
              ? `备份保存到 Linux 本地目录；当前上限 ${formatSize(status.maxBytes)}。`
              : '请先配置备份存储。'}
      </p>
      {busy && (
        <p className="set-note" role="status" aria-live="polite">
          {busyMessage}
        </p>
      )}
      {status?.mode === 'local' && (
        <>
          <div className="set-row set-backup__settings-row">
            <label className="set-label" htmlFor="backup-automatic">
              每日自动备份
            </label>
            <Switch
              id="backup-automatic"
              ariaLabel="每日自动备份"
              checked={automatic}
              disabled={!status || busy || (!status.schedulerReady && !automatic)}
              onChange={setAutomatic}
            />
            <span className="set-note">{status?.schedulerReady ? '每天自动执行' : '需配置持久存储和任务运行器'}</span>
          </div>
          <div className="set-row set-backup__settings-row">
            <label className="set-label">自动备份保留份数</label>
            <InlineSelect
              className="set-input set-backup__retention"
              value={String(retention)}
              disabled={busy}
              ariaLabel="自动备份保留份数"
              onChange={(value) => setRetention(Number(value))}
              options={RETENTION_OPTIONS}
            />
            <button
              className="set-btn"
              disabled={busy || !status || (automatic && !status.schedulerReady)}
              onClick={() => void saveConfig()}
            >
              保存
            </button>
          </div>
        </>
      )}
      {(status?.mode === 'local' || status?.mode === 'vercel') && (
        <div className="set-row">
          <button className="set-btn" disabled={busy || !status || status.busy} onClick={() => void create()}>
            <Play size={15} />
            {status.mode === 'vercel' ? '生成并下载备份' : '立即备份'}
          </button>
          <button className="set-btn" disabled={busy} onClick={() => void act(async () => {})}>
            <RefreshCw size={15} />
            刷新
          </button>
        </div>
      )}
      {status?.runs.map((run) => (
        <div className="set-row" key={run.id}>
          <div className="set-backup__run-info">
            <strong>
              {run.kind === 'windows'
                ? 'Windows 数据库备份'
                : run.kind === 'protection'
                  ? '恢复前保护备份'
                  : run.kind === 'automatic'
                    ? '自动备份'
                    : '手动备份'}
            </strong>
            <div className="set-note">
              {run.filename && <span>{run.filename} · </span>}
              {formatDate(Number(run.created_at))} · {formatSize(Number(run.size_bytes))} ·{' '}
              {run.status === 'success' ? '完成' : run.status === 'running' ? '执行中' : '失败'} {run.error}
            </div>
          </div>
          {run.status === 'success' && status.mode !== 'vercel' && (
            <button
              className="set-btn"
              title="下载备份"
              aria-label="下载备份"
              disabled={busy}
              onClick={() => void download(run)}
            >
              <Download size={16} />
              下载
            </button>
          )}
          {status.mode !== 'windows' && (
            <button
              className="set-btn"
              title={status.mode === 'vercel' ? '删除备份记录' : '删除备份'}
              aria-label={status.mode === 'vercel' ? '删除备份记录' : '删除备份'}
              disabled={busy}
              onClick={() => remove(run)}
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      ))}
      {status?.hasMore && (
        <button
          className="set-btn"
          disabled={busy}
          onClick={() =>
            void act(async () => {
              const next = await request(`/api/backups?offset=${status.runs.length}`);
              setStatus({ ...next, runs: [...status.runs, ...next.runs] });
            }, false)
          }
        >
          加载更多备份
        </button>
      )}
      {status?.mode === 'windows' && (
        <>
          <p className="set-note">所有已完成的 .dump 均可下载；创建、定时与恢复请打开 Windows 控制中心 → 数据备份。</p>
          <button className="set-btn" disabled={busy} onClick={() => void act(async () => {})}>
            <RefreshCw size={15} />
            刷新
          </button>
        </>
      )}
      <div className="set-row">
        <input
          id="backup-file-input"
          type="file"
          accept=".novora-backup,application/json"
          hidden
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.currentTarget.value = '';
            if (file) void uploadFile(file);
          }}
        />
        <button
          className="set-btn"
          disabled={busy || !status || status.mode === 'windows' || status.mode === 'unconfigured'}
          onClick={chooseFile}
        >
          <Upload size={15} />
          1. 选择备份文件
        </button>
        <span className="set-note">
          仅支持 .novora-backup 文件（最大 {formatSize(status?.maxBytes ?? 20 * 1024 * 1024)}
          ），选中后会先校验并展示内容。
        </span>
      </div>
      {preview && (
        <div className="set-backup__preview">
          <h3 className="set-card__title">2. 检查备份内容</h3>
          <p className="set-note">文件：{preview.filename}</p>
          <p className="set-note">
            创建于 {formatDate(preview.createdAt)} · {formatSize(preview.bytes)} · SHA-256{' '}
            {preview.checksum.slice(0, 16)}…
          </p>
          <p className="set-note">这份备份包含以下内容</p>
          <ul className="set-backup__contents">
            {preview.tables.map((item) => (
              <li key={item.table}>
                {CONTENT_LABELS[item.table] ?? '其他应用数据'} <span>{item.rows} 项</span>
              </li>
            ))}
          </ul>
          <p className="set-note">备份中的管理员：{preview.administrators.join('、')}</p>
          <p className="set-note set-backup__warning">
            3. 确认后将覆盖当前学校数据和账号；恢复前会先生成一份可下载的保护备份。
          </p>
          <div className="set-backup__restore-form">
            <label className="set-backup__field">
              <span>当前超级管理员密码</span>
              <input
                aria-label="当前超级管理员密码"
                className="set-input"
                type="password"
                autoComplete="current-password"
                placeholder="输入当前密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label className="set-backup__field">
              <span>确认恢复</span>
              <input
                aria-label="输入 RESTORE 确认恢复"
                className="set-input"
                placeholder="输入 RESTORE"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>
          </div>
          <div className="set-row set-backup__restore-actions">
            <button className="set-btn" disabled={busy || !password || confirm !== 'RESTORE'} onClick={restore}>
              <RotateCcw size={15} />
              确认恢复
            </button>
            <button className="set-btn" disabled={busy} onClick={() => setPreview(null)}>
              取消
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="set-note set-note--warn" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="set-note" role="status" aria-live="polite">
          {notice}
        </p>
      )}
    </section>
  );
}
