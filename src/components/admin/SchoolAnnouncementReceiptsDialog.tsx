import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import AdminModalPortal from '../AdminModalPortal';
import InlineSelect from '../InlineSelect';
import Mascot from '../Mascot';
import RefreshButton from './RefreshButton';
import { getAppSettings } from '../../utils/appSettings';
import { formatApiError } from '../../services/apiError';
import { formatDateTimeInZone } from '../../utils/timeSource';
import { fetchAnnouncementReceipts, type SchoolAnnouncementReceipts } from '../../services/examAnnouncements';
import { ANNOUNCEMENT_STYLE_LABELS } from '../../shared/examAnnouncementContracts.js';

type Props = {
  announcementId: string;
  /** 列表里那行的标题，加载完成前先顶上，避免弹窗空着。 */
  title: string;
  onClose: () => void;
};

const VIEW_OPTIONS = [
  { value: 'all', label: '全部设备' },
  { value: 'seen', label: '已读' },
  { value: 'unseen', label: '未读' },
  { value: 'undelivered', label: '未送达' },
];

function durationText(ms: number): string {
  if (!ms) return '—';
  if (ms < 60_000) return `${Math.round(ms / 1000)} 秒`;
  return `${Math.round(ms / 60_000)} 分钟`;
}

/**
 * 公告回执明细（设备口径，2026-09-25 定稿）。
 *
 * 「已读」= 这台教室大屏把公告真正展示满 3 秒；「送达」= 设备拉到过这条公告。
 * 应达设备数按发布范围现算：设备换绑后历史公告的应达数会跟着变，这是有意的。
 */
export default function SchoolAnnouncementReceiptsDialog({ announcementId, title, onClose }: Props) {
  const { grades, classes } = getAppSettings().exam;
  const [data, setData] = useState<SchoolAnnouncementReceipts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState('all');

  const load = async () => {
    setLoading(true);
    try {
      setData(await fetchAnnouncementReceipts(announcementId));
      setError('');
    } catch (cause) {
      setError(formatApiError(cause, '回执读取失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // 只在切换公告时重新拉取。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [announcementId]);

  const classLabel = useCallback(
    (gradeId: string, classId: string) => {
      const gradeName = grades.find((grade) => grade.id === gradeId)?.name ?? gradeId ?? '未绑定年级';
      const className = classes.find((item) => item.id === classId)?.name ?? (classId || '未绑定班级');
      return `${gradeName} · ${className}`;
    },
    [classes, grades],
  );

  const rows = useMemo(() => {
    if (!data) return [];
    const list = data.receipts.map((item) => ({
      ...item,
      label: classLabel(item.gradeId, item.classId),
      state: item.firstSeenAt ? 'seen' : item.deliveredAt ? 'delivered' : 'undelivered',
    }));
    if (view === 'all') return list;
    if (view === 'seen') return list.filter((item) => item.state === 'seen');
    if (view === 'unseen') return list.filter((item) => item.state === 'delivered');
    return list.filter((item) => item.state === 'undelivered');
  }, [classLabel, data, view]);

  const groups = useMemo(() => {
    const map = new Map<string, { label: string; target: number; seen: number }>();
    for (const item of data?.receipts ?? []) {
      const label = classLabel(item.gradeId, item.classId);
      const entry = map.get(label) ?? { label, target: 0, seen: 0 };
      entry.target += 1;
      if (item.firstSeenAt) entry.seen += 1;
      map.set(label, entry);
    }
    return [...map.values()].sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'));
  }, [classLabel, data]);

  const exportCsv = () => {
    if (!data || typeof document === 'undefined') return;
    const header = ['教室', '设备实例', '送达时间', '首次已读', '最后已读', '已读次数', '累计时长(秒)', '客户端版本'];
    const lines = data.receipts.map((item) =>
      [
        classLabel(item.gradeId, item.classId),
        item.instanceId,
        item.deliveredAt ? formatDateTimeInZone(item.deliveredAt) : '',
        item.firstSeenAt ? formatDateTimeInZone(item.firstSeenAt) : '',
        item.lastSeenAt ? formatDateTimeInZone(item.lastSeenAt) : '',
        String(item.seenCount),
        String(Math.round(item.seenMs / 1000)),
        item.clientVersion,
      ]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(','),
    );
    const csv = `\ufeff${[header.join(','), ...lines].join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `公告回执-${data.announcement.title || data.announcement.id}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const summary = data?.summary;
  const rate = summary && summary.target > 0 ? Math.round((summary.seen / summary.target) * 100) : 0;

  return (
    <AdminModalPortal
      className="admin-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="公告回执"
      onClick={onClose}
    >
      <div className="admin-modal admin-modal--wide sann-receipts" onClick={(event) => event.stopPropagation()}>
        <div className="sann-receipts__head">
          <div>
            <h2 className="admin-modal__title" style={{ margin: 0 }}>
              公告回执
            </h2>
            <p className="sann-receipts__lead">
              {data?.announcement.title || title || '未命名公告'}
              {data ? ` · ${ANNOUNCEMENT_STYLE_LABELS[data.announcement.style]} · 按教室大屏统计` : ''}
            </p>
          </div>
          <div className="sann-receipts__actions">
            <RefreshButton className="admin-btn admin-btn--ghost" busy={loading} onRefresh={() => void load()} />
            <button
              className="admin-btn admin-btn--ghost"
              type="button"
              disabled={!data || !data.receipts.length}
              onClick={exportCsv}
            >
              <Download size={15} aria-hidden="true" />
              导出 CSV
            </button>
            <button className="admin-btn admin-btn--ghost" type="button" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>

        {error && <div className="admin-error">{error}</div>}
        {loading && !data ? (
          <div className="sann-empty">回执加载中…</div>
        ) : !data ? (
          <div className="admin-empty">
            <Mascot className="mascot-empty" size={48} alt="" />
            <p>没有读到回执。</p>
          </div>
        ) : (
          <>
            <div className="sann-receipts__stats">
              <div>
                <span>应达教室</span>
                <strong>{summary?.target ?? 0}</strong>
              </div>
              <div>
                <span>已送达</span>
                <strong>{summary?.delivered ?? 0}</strong>
              </div>
              <div className="is-primary">
                <span>已读（≥3 秒）</span>
                <strong>
                  {summary?.seen ?? 0}
                  <small> · {rate}%</small>
                </strong>
              </div>
              <div>
                <span>还没看</span>
                <strong>{Math.max(0, (summary?.target ?? 0) - (summary?.seen ?? 0))}</strong>
              </div>
            </div>
            <div className="sann-receipts__bar" role="img" aria-label={`已读 ${rate}%`}>
              <span style={{ width: `${rate}%` }} />
            </div>

            {groups.length > 0 && (
              <div className="sann-receipts__groups">
                {groups.map((group) => (
                  <span key={group.label} className={group.seen >= group.target ? 'is-done' : undefined}>
                    {group.label} {group.seen}/{group.target}
                  </span>
                ))}
              </div>
            )}

            <div className="sann-receipts__toolbar">
              <InlineSelect value={view} ariaLabel="按回执状态筛选" onChange={setView} options={VIEW_OPTIONS} />
              <span className="sann-note">
                共 {data.receipts.length} 台设备 · 当前筛选 {rows.length} 台
              </span>
            </div>

            {rows.length === 0 ? (
              <div className="sann-empty">这个筛选下没有设备。</div>
            ) : (
              <div className="sann-receipts__table">
                <table>
                  <thead>
                    <tr>
                      <th>教室</th>
                      <th>状态</th>
                      <th>首次已读</th>
                      <th>累计时长</th>
                      <th>次数</th>
                      <th>设备</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((item) => (
                      <tr key={item.instanceId} className={item.state === 'seen' ? 'is-seen' : undefined}>
                        <td>{item.label}</td>
                        <td>
                          <span
                            className={`sann-badge${
                              item.state === 'seen' ? ' is-active' : item.state === 'delivered' ? '' : ' is-warn'
                            }`}
                          >
                            {item.state === 'seen' ? '已读' : item.state === 'delivered' ? '已送达未看' : '未送达'}
                          </span>
                        </td>
                        <td>{item.firstSeenAt ? formatDateTimeInZone(item.firstSeenAt) : '—'}</td>
                        <td>{durationText(item.seenMs)}</td>
                        <td>{item.seenCount || '—'}</td>
                        <td className="sann-receipts__device">
                          <code>{item.instanceId}</code>
                          {item.clientVersion && <small>{item.clientVersion}</small>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </AdminModalPortal>
  );
}
