import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Megaphone } from 'lucide-react';
import HelpTip from './HelpTip';
import RefreshButton from './admin/RefreshButton';
import InlineSelect from './InlineSelect';
import ClassMultiPicker, { type ClassPickerOption } from './ClassMultiPicker';
import Mascot from './Mascot';
import { getAppSettings } from '../utils/appSettings';
import { getAdminUser } from '../services/examService';
import { resolveDeviceScope } from '../utils/deviceScope';
import { confirmDialog } from '../services/appDialog';
import { formatApiError } from '../services/apiError';
import { notify } from '../services/notify';
import { formatDateTimeInZone } from '../utils/timeSource';
import {
  fetchSchoolAnnouncements,
  revokeSchoolAnnouncement,
  sendExamAnnouncement,
  type SchoolAnnouncementQuery,
  type SchoolExamAnnouncement,
} from '../services/examAnnouncements';
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_DEFAULT_EXPIRES_MINUTES,
  ANNOUNCEMENT_EXPIRY_OPTIONS,
  ANNOUNCEMENT_SCOPE_LABELS,
  ANNOUNCEMENT_STATUS_LABELS,
  ANNOUNCEMENT_TITLE_MAX,
  type AnnouncementLevel,
  type AnnouncementScopeType,
  type AnnouncementStatus,
} from '../shared/examAnnouncementContracts.js';
import '../styles/school-announcements.css';
// 预览直接复用教室大屏的公告卡片样式，保证"后台看到的"与"大屏显示的"是同一种排版。
import '../styles/exam-announcement-overlay.css';

const PAGE_SIZE = 20;

type Draft = {
  title: string;
  body: string;
  level: AnnouncementLevel;
  scope: AnnouncementScopeType;
  gradeIds: string[];
  classIds: string[];
  expiry: string;
};

const emptyDraft = (): Draft => ({
  title: '',
  body: '',
  level: 'normal',
  scope: 'all',
  gradeIds: [],
  classIds: [],
  expiry: String(ANNOUNCEMENT_DEFAULT_EXPIRES_MINUTES),
});

const STATUS_FILTER_OPTIONS = [
  { value: 'active', label: '生效中' },
  { value: 'expired', label: '已过期' },
  { value: 'revoked', label: '已撤回' },
  { value: 'all', label: '全部' },
];

const LEVEL_FILTER_OPTIONS = [
  { value: 'all', label: '全部级别' },
  { value: 'normal', label: '普通' },
  { value: 'urgent', label: '紧急' },
];

const SCOPE_FILTER_OPTIONS = [
  { value: 'any', label: '全部范围' },
  { value: 'all', label: '全校' },
  { value: 'grade', label: '年级' },
  { value: 'class', label: '班级' },
];

/**
 * 学校公告管理页（后台一级板块「公告」）。
 *
 * 只管理学校自己发出去的公告（学校 → 教室大屏）。作者端统一公告是另一条通道，
 * 仍由遥测台发布、在「更多 → 查看公告」查看，本页不掺进来。
 */
export default function SchoolAnnouncementsPanel({ can }: { can: (permission: string) => boolean }) {
  const canSend = can('major.edit');
  const { grades, classes } = getAppSettings().exam;
  const adminUser = getAdminUser();
  // 只能给自己范围里的年级/班级发公告：范围外的班级即使手滑选中，服务端也不会送达，先在这里就收敛掉。
  const deviceScope = useMemo(() => resolveDeviceScope(grades, classes, adminUser), [classes, adminUser, grades]);

  const classOptions: ClassPickerOption[] = useMemo(
    () =>
      deviceScope.classes.map((item) => ({
        id: item.id,
        gradeId: item.gradeId,
        gradeName: grades.find((grade) => grade.id === item.gradeId)?.name ?? '未知年级',
        className: item.name,
      })),
    [deviceScope.classes, grades],
  );

  // 班级要带年级一起显示：不同年级都有「1 班」，只写班名会分不清是哪个班。
  const classLabel = useCallback(
    (classId: string, missing = '已删除班级'): string => {
      const option = classOptions.find((item) => item.id === classId);
      if (!option) return missing;
      return `${option.gradeName} · ${option.className}`;
    },
    [classOptions],
  );

  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [sending, setSending] = useState(false);
  const [draftError, setDraftError] = useState('');

  const [filters, setFilters] = useState<{
    status: AnnouncementStatus | 'all';
    level: AnnouncementLevel | 'all';
    scope: AnnouncementScopeType | 'any';
  }>({ status: 'active', level: 'all', scope: 'any' });
  const [items, setItems] = useState<SchoolExamAnnouncement[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [revokingId, setRevokingId] = useState('');

  const query: SchoolAnnouncementQuery = useMemo(
    () => ({
      status: filters.status,
      level: filters.level,
      scope: filters.scope,
      limit: PAGE_SIZE,
    }),
    [filters],
  );

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setListLoading(true);
      try {
        const page = await fetchSchoolAnnouncements(query);
        setItems(page.items);
        setHasMore(page.hasMore);
        setListError('');
      } catch (cause) {
        setListError(formatApiError(cause, '公告列表加载失败'));
      } finally {
        setListLoading(false);
      }
    },
    [query],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    setListLoading(true);
    try {
      const page = await fetchSchoolAnnouncements({ ...query, offset: items.length });
      setItems((current) => [...current, ...page.items]);
      setHasMore(page.hasMore);
      setListError('');
    } catch (cause) {
      setListError(formatApiError(cause, '公告列表加载失败'));
    } finally {
      setListLoading(false);
    }
  };

  const scopeIdsForSend = draft.scope === 'grade' ? draft.gradeIds : draft.classIds;
  const scopeSummary = useMemo(() => {
    if (draft.scope === 'all') return '全校教室大屏';
    const names = scopeIdsForSend
      .map((id) => (draft.scope === 'grade' ? (grades.find((grade) => grade.id === id)?.name ?? id) : classLabel(id)))
      .filter(Boolean);
    if (!names.length) return draft.scope === 'grade' ? '未选择年级' : '未选择班级';
    const shown = names.slice(0, 3).join('、');
    return names.length > 3 ? `${shown} 等 ${names.length} 个${draft.scope === 'grade' ? '年级' : '班级'}` : shown;
  }, [classLabel, draft.scope, grades, scopeIdsForSend]);

  const expiryLabel = ANNOUNCEMENT_EXPIRY_OPTIONS.find((option) => option.value === draft.expiry)?.label ?? '2 小时';

  const resetDraft = () => {
    setDraft(emptyDraft());
    setDraftError('');
  };

  const send = async () => {
    const title = draft.title.trim();
    const body = draft.body.trim();
    if (!title && !body) {
      setDraftError('标题或内容至少填一项。');
      return;
    }
    if (draft.scope !== 'all' && scopeIdsForSend.length === 0) {
      setDraftError(draft.scope === 'grade' ? '请选择至少一个年级。' : '请选择至少一个班级。');
      return;
    }
    setSending(true);
    setDraftError('');
    try {
      await sendExamAnnouncement({
        title,
        body,
        level: draft.level,
        scopeType: draft.scope,
        scopeIds: draft.scope === 'all' ? [] : scopeIdsForSend,
        expiresInMinutes: Number(draft.expiry),
      });
      notify(
        'success',
        `公告已发送到 ${scopeSummary}，教室大屏 1 分钟内更新。`,
        draft.level === 'urgent' ? '紧急公告已发送' : '公告已发送',
      );
      resetDraft();
      // 新公告一定是"生效中"，发完把筛选切回生效中才能立刻看到它。
      if (filters.status === 'active' && filters.level === 'all' && filters.scope === 'any') {
        await load(true);
      } else {
        setFilters({ status: 'active', level: 'all', scope: 'any' });
      }
    } catch (cause) {
      setDraftError(formatApiError(cause, '公告发送失败'));
    } finally {
      setSending(false);
    }
  };

  const revoke = async (item: SchoolExamAnnouncement) => {
    const confirmed = await confirmDialog({
      title: '撤回公告',
      message: `撤回后「${item.title || '这条公告'}」会在大屏 1 分钟内消失，记录仍保留在列表里。`,
      tone: 'warning',
      confirmLabel: '撤回',
    });
    if (!confirmed) return;
    setRevokingId(item.id);
    try {
      await revokeSchoolAnnouncement(item.id);
      notify('success', '公告已撤回，教室大屏 1 分钟内更新。', '已撤回');
      await load(true);
    } catch (cause) {
      notify('error', formatApiError(cause, '公告撤回失败'), '撤回失败');
    } finally {
      setRevokingId('');
    }
  };

  const audienceLabel = (item: SchoolExamAnnouncement): string => {
    if (item.scopeType === 'all') return ANNOUNCEMENT_SCOPE_LABELS.all;
    const names = item.scopeIds.map((id) =>
      item.scopeType === 'grade' ? (grades.find((grade) => grade.id === id)?.name ?? '已删除年级') : classLabel(id),
    );
    const noun = item.scopeType === 'grade' ? '年级' : '班级';
    if (!names.length) return `指定${noun}`;
    const shown = names.slice(0, 3).join('、');
    return names.length > 3 ? `${shown} 等 ${names.length} 个${noun}` : shown;
  };

  const timeLabel = (value: number | null, fallback = '不过期') =>
    value && Number.isFinite(value) ? formatDateTimeInZone(value) : fallback;

  return (
    <main className="school-announcements">
      <div className="device-status__heading">
        <div>
          <h2>
            <span className="with-help-tip">
              公告
              <HelpTip title="学校公告与作者端公告">
                这里是学校自己发的公告，会下发到所选范围的教室大屏；紧急公告置顶且不能关闭。
                作者端统一公告由遥测台发布，可在「更多 → 查看公告」里查看。
              </HelpTip>
            </span>
          </h2>
          <p>发布、查看和撤回学校公告；生效中的公告会在大屏上展示，大屏每分钟拉取一次。</p>
        </div>
        <RefreshButton className="admin-btn" busy={listLoading} onRefresh={() => void load()} title="刷新公告列表" />
      </div>

      <section className="sann-card">
        <header className="sann-card__head">
          <h3>
            <Megaphone aria-hidden="true" />
            发布公告
          </h3>
          {!canSend && <span className="sann-note">当前账号只能查看，发送需要「编辑大型考试」权限。</span>}
        </header>
        <div className="sann-compose">
          <div className="sann-compose__fields">
            <label className="admin-label">
              标题
              <input
                className="admin-input"
                value={draft.title}
                maxLength={ANNOUNCEMENT_TITLE_MAX}
                disabled={!canSend || sending}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                placeholder="如：本场考试延长 15 分钟"
              />
            </label>
            <label className="admin-label">
              内容
              <textarea
                className="admin-input"
                rows={4}
                value={draft.body}
                maxLength={ANNOUNCEMENT_BODY_MAX}
                disabled={!canSend || sending}
                onChange={(event) => setDraft({ ...draft, body: event.target.value })}
                placeholder="写清楚要通知教室的内容；紧急公告会在大屏置顶。"
              />
            </label>
            <div className="sann-compose__row">
              <label className="admin-label">
                级别
                <InlineSelect
                  value={draft.level}
                  disabled={!canSend || sending}
                  onChange={(value) => setDraft({ ...draft, level: value === 'urgent' ? 'urgent' : 'normal' })}
                  options={[
                    { value: 'normal', label: '普通（可关闭）' },
                    { value: 'urgent', label: '紧急（置顶，不可关闭）' },
                  ]}
                />
              </label>
              <label className="admin-label">
                范围
                <InlineSelect
                  value={draft.scope}
                  disabled={!canSend || sending}
                  onChange={(value) =>
                    setDraft({
                      ...draft,
                      scope: value === 'grade' ? 'grade' : value === 'class' ? 'class' : 'all',
                    })
                  }
                  options={[
                    { value: 'all', label: '全校' },
                    { value: 'grade', label: '指定年级' },
                    { value: 'class', label: '指定班级' },
                  ]}
                />
              </label>
              <label className="admin-label">
                有效期
                <InlineSelect
                  value={draft.expiry}
                  disabled={!canSend || sending}
                  onChange={(value) => setDraft({ ...draft, expiry: value })}
                  options={ANNOUNCEMENT_EXPIRY_OPTIONS}
                />
              </label>
            </div>
            {draft.scope === 'grade' && (
              <div className="sann-scope-picker">
                <span className="sann-scope-picker__title">选择年级</span>
                {deviceScope.grades.length === 0 ? (
                  <p className="sann-note">当前账号没有可发布的年级范围。</p>
                ) : (
                  <div className="sann-chips">
                    {deviceScope.grades.map((grade) => {
                      const checked = draft.gradeIds.includes(grade.id);
                      return (
                        <button
                          type="button"
                          key={grade.id}
                          className={`sann-chip${checked ? ' is-active' : ''}`}
                          aria-pressed={checked}
                          disabled={!canSend || sending}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              gradeIds: checked
                                ? draft.gradeIds.filter((id) => id !== grade.id)
                                : [...draft.gradeIds, grade.id],
                            })
                          }
                        >
                          {grade.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {draft.scope === 'class' && (
              <div className="sann-scope-picker">
                <span className="sann-scope-picker__title">选择班级</span>
                <ClassMultiPicker
                  options={classOptions}
                  selectedIds={draft.classIds}
                  disabled={!canSend || sending}
                  noun="班级"
                  onChange={(ids) => setDraft({ ...draft, classIds: ids })}
                />
              </div>
            )}
            {draftError && <div className="admin-error">{draftError}</div>}
            <div className="sann-compose__actions">
              <button
                className="admin-btn admin-btn--primary"
                type="button"
                disabled={!canSend || sending}
                onClick={() => void send()}
              >
                {sending ? '发送中…' : '发送公告'}
              </button>
              <button className="admin-btn admin-btn--ghost" type="button" disabled={sending} onClick={resetDraft}>
                清空
              </button>
            </div>
          </div>
          <aside className="sann-preview">
            <div className="sann-preview__head">教室大屏展示效果</div>
            <ul className="eann-school">
              <li className={draft.level === 'urgent' ? 'is-urgent' : undefined}>
                <header>
                  <strong>{draft.title.trim() || '公告标题'}</strong>
                  <em>{draft.level === 'urgent' ? '紧急' : '学校公告'}</em>
                </header>
                <p>{draft.body.trim() || '公告内容会显示在这里。'}</p>
                <small>
                  {scopeSummary} · 展示 {expiryLabel}
                </small>
              </li>
            </ul>
          </aside>
        </div>
      </section>

      <section className="sann-card">
        <header className="sann-card__head">
          <h3>公告记录</h3>
          <div className="sann-filters">
            <InlineSelect
              value={filters.status}
              ariaLabel="按状态筛选"
              onChange={(value) => setFilters({ ...filters, status: value as AnnouncementStatus | 'all' })}
              options={STATUS_FILTER_OPTIONS}
            />
            <InlineSelect
              value={filters.level}
              ariaLabel="按级别筛选"
              onChange={(value) => setFilters({ ...filters, level: value as AnnouncementLevel | 'all' })}
              options={LEVEL_FILTER_OPTIONS}
            />
            <InlineSelect
              value={filters.scope}
              ariaLabel="按范围筛选"
              onChange={(value) => setFilters({ ...filters, scope: value as AnnouncementScopeType | 'any' })}
              options={SCOPE_FILTER_OPTIONS}
            />
          </div>
        </header>
        {listError && <div className="admin-error">{listError}</div>}
        {listLoading && items.length === 0 ? (
          <div className="sann-empty">公告加载中…</div>
        ) : items.length === 0 ? (
          <div className="admin-empty">
            <Mascot className="mascot-empty" size={56} alt="" />
            <p>没有符合条件的公告。</p>
          </div>
        ) : (
          <ul className="sann-list">
            {items.map((item) => (
              <li key={item.id} className={`sann-item is-${item.status}`}>
                <div className="sann-item__main">
                  <div className="sann-item__title">
                    <strong>{item.title || '无标题公告'}</strong>
                    <span className={`sann-badge is-${item.status}`}>{ANNOUNCEMENT_STATUS_LABELS[item.status]}</span>
                    {item.level === 'urgent' && <span className="sann-badge is-urgent">紧急</span>}
                  </div>
                  {item.body && <p className="sann-item__body">{item.body}</p>}
                  <div className="sann-item__meta">
                    <span>{audienceLabel(item)}</span>
                    <span>发送 {formatDateTimeInZone(item.createdAt)}</span>
                    <span>{item.expiresAt ? `有效至 ${timeLabel(item.expiresAt)}` : '不过期'}</span>
                    {item.examId && <span>关联考试 {item.examId}</span>}
                  </div>
                </div>
                {canSend && item.status === 'active' && (
                  <button
                    className="admin-btn admin-btn--danger"
                    type="button"
                    disabled={revokingId === item.id}
                    onClick={() => void revoke(item)}
                  >
                    {revokingId === item.id ? '撤回中…' : '撤回'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {hasMore && (
          <div className="sann-more">
            <button className="admin-btn" type="button" disabled={listLoading} onClick={() => void loadMore()}>
              {listLoading ? '加载中…' : '加载更多'}
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
