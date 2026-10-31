import { useEffect, useState } from 'react';
import { apiFetch } from '../../services/auth/client';
import { clearPendingExamSync } from '../../services/examOutbox';
import { clearAuthSession } from '../../services/auth/session';
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
};
type Status = {
  mode: 'local' | 'blob' | 'windows' | 'unconfigured';
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
};
const CHUNK = 512 * 1024;
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
async function request(url: string, init?: RequestInit) {
  const response = await apiFetch(url, init, 60_000);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) throw new Error(body.error || `请求失败 (${response.status})`);
  return body;
}
export default function BackupRestoreSection({ onRestored }: { onRestored: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [automatic, setAutomatic] = useState(false);
  const [retention, setRetention] = useState(14);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const refresh = async () => {
    const next = await request('/api/backups');
    setStatus(next);
    setAutomatic(next.enabled);
    setRetention(next.retention);
  };
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);
  const act = async (action: () => Promise<void>, reload = true) => {
    setBusy(true);
    setError('');
    try {
      await action();
      if (reload) await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };
  const create = () =>
    act(async () => {
      await request('/api/backups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create' }),
      });
    });
  const saveConfig = () =>
    act(async () => {
      await request('/api/backups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'configure', enabled: automatic, retention }),
      });
    });
  const download = (run: BackupRun) =>
    act(async () => {
      const first = await request(`/api/backups?file=${encodeURIComponent(run.id)}&part=0`);
      const chunks = [decodeBase64(first.content)];
      for (let part = 1; part < first.total; part++) {
        const next = await request(`/api/backups?file=${encodeURIComponent(run.id)}&part=${part}`);
        chunks.push(decodeBase64(next.content));
      }
      const blob = new Blob(chunks, { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = first.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }, false);
  const remove = (run: BackupRun) => {
    if (window.confirm('删除这份服务端备份？已下载到本机的文件不受影响。'))
      void act(async () => {
        await request(`/api/backups?id=${encodeURIComponent(run.id)}`, { method: 'DELETE' });
      });
  };
  const chooseFile = () => document.getElementById('backup-file-input')?.click();
  const uploadFile = async (file: File) =>
    act(async () => {
      setPreview(null);
      setPassword('');
      setConfirm('');
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      const total = Math.ceil(file.size / CHUNK);
      if (!total || file.size > 20 * 1024 * 1024) throw new Error('文件为空或超过 20 MiB');
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
      setPreview({ ...info, uploadId: id });
    });
  const restore = () => {
    if (!preview || confirm !== 'RESTORE' || !password) return;
    if (!window.confirm('恢复将替换当前学校数据和账号。系统会先保存一份可下载的恢复前备份，确定继续？')) return;
    void act(async () => {
      await request('/api/backups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'restore',
          uploadId: preview.uploadId,
          checksum: preview.checksum,
          password,
          confirm,
        }),
      });
      setPreview(null);
      setPassword('');
      setConfirm('');
      clearPendingExamSync();
      clearAuthSession();
      window.alert(`恢复完成。恢复前备份已保存，可在备份列表中下载。`);
      onRestored();
    }, false);
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
        当前存储：
        {status?.mode === 'blob'
          ? 'Vercel 私有 Blob'
          : status?.mode === 'local'
            ? 'NAS 持久目录'
            : status?.mode === 'windows'
              ? 'Windows 客户端控制中心'
              : '尚未配置'}
        。
        {status?.mode === 'windows'
          ? '提供原有 .dump 文件下载。'
          : 'Web 单份备份上限 20 MiB；超出时请使用数据库原生备份。'}
      </p>
      {status?.mode !== 'windows' && (
        <>
          <div className="set-row">
            <label className="set-label" htmlFor="backup-automatic">
              每日自动备份
            </label>
            <input
              id="backup-automatic"
              type="checkbox"
              checked={automatic}
              disabled={!status || busy || (!status.schedulerReady && !automatic)}
              onChange={(e) => setAutomatic(e.target.checked)}
            />
            <span className="set-note">{status?.schedulerReady ? '每天自动执行' : '需配置持久存储和任务运行器'}</span>
          </div>
          <div className="set-row">
            <label className="set-label" htmlFor="backup-retention">
              自动备份保留份数
            </label>
            <input
              id="backup-retention"
              className="set-input set-input--sm"
              type="number"
              min="1"
              max="365"
              value={retention}
              disabled={busy}
              onChange={(e) => setRetention(Number(e.target.value))}
            />
            <button
              className="set-btn"
              disabled={busy || !status || (automatic && !status.schedulerReady)}
              onClick={() => void saveConfig()}
            >
              保存
            </button>
          </div>
          <div className="set-row">
            <button
              className="set-btn"
              disabled={busy || !status || status.busy || status.mode === 'unconfigured'}
              onClick={() => void create()}
            >
              <Play size={15} />
              立即备份
            </button>
            <button className="set-btn" disabled={busy} onClick={() => void act(async () => {})}>
              <RefreshCw size={15} />
              刷新
            </button>
          </div>
        </>
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
          {run.status === 'success' && (
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
              title="删除备份"
              aria-label="删除备份"
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
          选择备份文件并预览
        </button>
      </div>
      {preview && (
        <div className="set-backup__preview">
          <h3 className="set-card__title">恢复预览</h3>
          <p className="set-note">
            创建于 {formatDate(preview.createdAt)} · {formatSize(preview.bytes)} · SHA-256{' '}
            {preview.checksum.slice(0, 16)}…
          </p>
          <p className="set-note">管理员：{preview.administrators.join('、')}</p>
          <p className="set-note">{preview.tables.map((t) => `${t.table} ${t.rows} 行`).join(' · ')}</p>
          <div className="set-row">
            <input
              aria-label="当前超级管理员密码"
              className="set-input"
              type="password"
              autoComplete="current-password"
              placeholder="当前超级管理员密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <input
              aria-label="输入 RESTORE 确认恢复"
              className="set-input"
              placeholder="输入 RESTORE"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            <button className="set-btn" disabled={busy || !password || confirm !== 'RESTORE'} onClick={restore}>
              <RotateCcw size={15} />
              恢复
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
    </section>
  );
}
