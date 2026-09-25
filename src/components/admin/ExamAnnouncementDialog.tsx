import { useEffect, useState } from 'react';
import AdminModalPortal from '../AdminModalPortal';
import InlineSelect from '../InlineSelect';
import { sendExamAnnouncement } from '../../services/examAnnouncements';
import { formatApiError } from '../../services/apiError';
import { notify } from '../../services/notify';
import {
  ANNOUNCEMENT_EXPIRY_OPTIONS,
  ANNOUNCEMENT_STYLES,
  type AnnouncementStyle,
} from '../../shared/examAnnouncementContracts.js';

type Props = {
  open: boolean;
  onClose: () => void;
  /** 从哪场考试发出的（决定默认范围与审计里的关联）。 */
  record?: { id: string; name: string; targetGradeIds: string[]; targetClassIds: string[] };
  gradeName?: string;
  className?: string;
};

/**
 * 学校侧考试公告发送（T-286-03 一期）。
 * 一期口径：范围只做 全校 / 年级 / 班级（不做楼栋），不需要回执；
 * `urgent` 在大屏置顶且不可关闭，并优先于作者端公告。
 *
 * 这里是从某场考试出发的快捷发送（范围默认取该场考试）；日常发布/撤回在
 * 后台「公告」板块（`components/SchoolAnnouncementsPanel.tsx`）。
 */
export default function ExamAnnouncementDialog({ open, onClose, record, gradeName, className }: Props) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [level, setLevel] = useState<'normal' | 'urgent'>('normal');
  const [style, setStyle] = useState<AnnouncementStyle>('card');
  const [scope, setScope] = useState<'exam' | 'all'>('exam');
  const [expiry, setExpiry] = useState('120');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setBody('');
    setLevel('normal');
    setStyle('card');
    setScope('exam');
    setExpiry('120');
    setError('');
    setBusy(false);
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    if (!title.trim() && !body.trim()) {
      setError('标题或内容至少填一项');
      return;
    }
    setBusy(true);
    setError('');
    const classIds = record?.targetClassIds ?? [];
    const gradeIds = record?.targetGradeIds ?? [];
    const useExamScope = scope === 'exam' && (classIds.length > 0 || gradeIds.length > 0);
    try {
      await sendExamAnnouncement({
        title: title.trim(),
        body: body.trim(),
        level,
        style,
        scopeType: useExamScope ? (classIds.length ? 'class' : 'grade') : 'all',
        scopeIds: useExamScope ? (classIds.length ? classIds : gradeIds) : [],
        ...(record?.id ? { examId: record.id } : {}),
        expiresInMinutes: Number(expiry),
      });
      notify(
        'success',
        `公告已发送${level === 'urgent' ? '（紧急，大屏置顶且需要等它过期才能关闭）' : ''}。`,
        '公告已发送',
      );
      onClose();
    } catch (caught) {
      setError(formatApiError(caught, '公告发送失败'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminModalPortal className="admin-modal-overlay" role="dialog" aria-modal="true" aria-label="发送考试公告">
      <div
        className={`admin-modal exam-announce-dialog ${className ?? ''}`.trim()}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="admin-modal__title">发送考试公告</h2>
        <p className="admin-modal__body">
          {record?.name ? `来自「${record.name}」。` : ''}
          公告会下发到所选范围的教室大屏；正文支持 Markdown；紧急公告置顶且不可关闭。
          需要插入图片或先看大屏预览，请到「公告」板块发布。
        </p>
        <label className="admin-label">
          标题
          <input
            className="admin-input"
            value={title}
            maxLength={120}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="如：本场考试延长 15 分钟"
          />
        </label>
        <label className="admin-label">
          内容
          <textarea
            className="admin-input"
            rows={4}
            value={body}
            maxLength={4000}
            onChange={(event) => setBody(event.target.value)}
            placeholder="写清楚要通知教室的内容；紧急公告会在大屏置顶。"
          />
        </label>
        <div className="exam-announce-dialog__row">
          <label className="admin-label">
            样式
            <InlineSelect
              value={style}
              onChange={(value) => setStyle(value as AnnouncementStyle)}
              options={ANNOUNCEMENT_STYLES.map((item) => ({ value: item.value, label: item.label }))}
            />
          </label>
          <label className="admin-label">
            级别
            <InlineSelect
              value={level}
              onChange={(value) => setLevel(value === 'urgent' ? 'urgent' : 'normal')}
              options={[
                { value: 'normal', label: '普通（可关闭）' },
                { value: 'urgent', label: '紧急（置顶，不可关闭）' },
              ]}
            />
          </label>
          <label className="admin-label">
            范围
            <InlineSelect
              value={scope}
              onChange={(value) => setScope(value === 'all' ? 'all' : 'exam')}
              options={[
                {
                  value: 'exam',
                  label: record?.targetClassIds?.length
                    ? `本场考试（${record.targetClassIds.length} 个班）`
                    : gradeName
                      ? `本场考试（${gradeName}）`
                      : '本场考试范围',
                },
                { value: 'all', label: '全校' },
              ]}
            />
          </label>
          <label className="admin-label">
            有效期
            <InlineSelect value={expiry} onChange={setExpiry} options={ANNOUNCEMENT_EXPIRY_OPTIONS} />
          </label>
        </div>
        {error && <div className="admin-error">{error}</div>}
        <div className="admin-modal__actions">
          <button className="admin-btn admin-btn--primary" type="button" disabled={busy} onClick={() => void submit()}>
            {busy ? '发送中…' : '发送公告'}
          </button>
          <button className="admin-btn admin-btn--ghost" type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </AdminModalPortal>
  );
}
