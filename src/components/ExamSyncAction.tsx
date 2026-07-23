import type { ExamDataSyncState } from '../hooks/useExamSync';

interface Props {
  state: ExamDataSyncState;
  lastSyncAt: number;
  hasPendingSync: boolean;
  onRefresh: () => void;
}

function labelFor(state: ExamDataSyncState, pending: boolean): string {
  if (state === 'syncing') return '正在同步…';
  if (state === 'offline') return '离线 · 载入本地';
  if (state === 'error') return '重试同步';
  if (state === 'auth-required') return '待管理员同步';
  if (pending || state === 'pending') return '同步本地修改';
  return '立即同步';
}

function statusFor(state: ExamDataSyncState, lastSyncAt: number, pending: boolean): string {
  if (state === 'offline') return '当前离线，正在显示本地安排';
  if (state === 'error') return '云端暂不可用，本地数据已保留';
  if (state === 'auth-required') return '本地修改待管理员登录后同步';
  if (pending || state === 'pending') return '本地修改待同步';
  if (state === 'syncing') return '正在检查最新考试安排';
  return lastSyncAt ? `数据已同步 · ${new Date(lastSyncAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}` : '已载入本地数据';
}

export default function ExamSyncAction({ state, lastSyncAt, hasPendingSync, onRefresh }: Props) {
  const busy = state === 'syncing';
  return (
    <div className={`exam-sync-action is-${state}${hasPendingSync ? ' has-pending' : ''}`}>
      <button type="button" className="exam-sync-action__button" onClick={onRefresh} disabled={busy} aria-label="重新载入考试数据">
        <span aria-hidden="true">{busy ? '◌' : '↻'}</span>{labelFor(state, hasPendingSync)}
      </button>
      <span className="exam-sync-action__status">{statusFor(state, lastSyncAt, hasPendingSync)}</span>
    </div>
  );
}
