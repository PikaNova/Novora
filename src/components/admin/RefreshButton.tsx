import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

type Props = {
  /** 触发一次刷新（通常是重新拉数据）。 */
  onRefresh: () => void;
  /** 父组件的数据加载状态：true → 按钮显示「刷新中…」并转圈。 */
  busy?: boolean;
  /** 空闲时的文案（默认「刷新」；刷新完成后会替换成「已刷新 HH:mm」）。 */
  label?: string;
  /** 按钮外观，默认后台的 ghost 按钮；设置页传 `set-btn set-btn--ghost`。 */
  className?: string;
  title?: string;
};

function clockText(ms: number): string {
  return new Date(ms).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

/**
 * 统一的刷新按钮。
 *
 * 约定（用户要求，全站适用）：刷新过程中**不要**把列表清空或置灰，界面保持原样，
 * 状态只体现在这个按钮上——「刷新中…」转圈，成功后变成「已刷新 12:34」。
 * 时间取自 busy 由 true 变 false 的那一刻，也就是这一次刷新真正结束的时间。
 */
export default function RefreshButton({ onRefresh, busy = false, label = '刷新', className, title }: Props) {
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const wasBusyRef = useRef(false);

  useEffect(() => {
    if (busy) {
      wasBusyRef.current = true;
      return;
    }
    if (!wasBusyRef.current) return;
    wasBusyRef.current = false;
    setRefreshedAt(Date.now());
  }, [busy]);

  const text = busy ? '刷新中…' : refreshedAt ? `已刷新 ${clockText(refreshedAt)}` : label;
  return (
    <button
      className={`${className ?? 'admin-btn admin-btn--ghost'} refresh-button`}
      type="button"
      onClick={onRefresh}
      disabled={busy}
      title={refreshedAt ? `上次刷新：${new Date(refreshedAt).toLocaleTimeString('zh-CN')}` : (title ?? label)}
    >
      <RefreshCw size={16} aria-hidden="true" className={busy ? 'is-spinning' : undefined} />
      {text}
    </button>
  );
}
