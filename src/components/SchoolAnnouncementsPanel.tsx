import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bold, ImagePlus, List, Megaphone, Type } from 'lucide-react';
import HelpTip from './HelpTip';
import RefreshButton from './admin/RefreshButton';
import InlineSelect from './InlineSelect';
import ClassMultiPicker, { type ClassPickerOption } from './ClassMultiPicker';
import Mascot from './Mascot';
import SchoolAnnouncementCard from './SchoolAnnouncementCard';
import SchoolAnnouncementPublishDialog from './admin/SchoolAnnouncementPublishDialog';
import SchoolAnnouncementReceiptsDialog from './admin/SchoolAnnouncementReceiptsDialog';
import { getAppSettings } from '../utils/appSettings';
import { getAdminUser } from '../services/examService';
import { resolveDeviceScope } from '../utils/deviceScope';
import { confirmDialog } from '../services/appDialog';
import { formatApiError } from '../services/apiError';
import { notify } from '../services/notify';
import { renderMarkdown } from '../utils/renderMarkdown';
import { formatDateTimeInZone } from '../utils/timeSource';
import {
  fetchSchoolAnnouncements,
  fetchAnnouncementStats,
  fetchAnnouncementTemplates,
  revokeSchoolAnnouncement,
  saveAnnouncementTemplate,
  sendExamAnnouncement,
  deleteAnnouncementTemplate,
  uploadSchoolAnnouncementImage,
  type SchoolAnnouncementQuery,
  type SchoolExamAnnouncement,
} from '../services/examAnnouncements';
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_DEFAULT_EXPIRES_MINUTES,
  ANNOUNCEMENT_EXPIRY_OPTIONS,
  ANNOUNCEMENT_IMAGE_MAX_BYTES,
  ANNOUNCEMENT_SCOPE_LABELS,
  ANNOUNCEMENT_STATUS_LABELS,
  ANNOUNCEMENT_STYLES,
  ANNOUNCEMENT_STYLE_LABELS,
  ANNOUNCEMENT_TITLE_MAX,
  isAnnouncementImageType,
  type AnnouncementStats,
  type AnnouncementLevel,
  type AnnouncementScopeType,
  type AnnouncementStatus,
  type AnnouncementStyle,
  type AnnouncementTemplate,
} from '../shared/examAnnouncementContracts.js';
import '../styles/school-announcements.css';

const PAGE_SIZE = 20;

type Draft = {
  title: string;
  body: string;
  level: AnnouncementLevel;
  style: AnnouncementStyle;
  /** 静默发布：只进公告列表，不自动弹（免打扰）。 */
  silent: boolean;
  scope: AnnouncementScopeType;
  gradeIds: string[];
  classIds: string[];
  expiry: string;
};

const emptyDraft = (): Draft => ({
  title: '',
  body: '',
  level: 'normal',
  style: 'card',
  silent: false,
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

/** 读取本地文件为 data URL；服务端会自己剥掉 `data:...;base64,` 前缀。 */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

/**
 * 学校公告管理页（后台一级板块「公告」）。
 *
 * 只管理学校自己发出去的公告（学校 → 教室大屏）。作者端统一公告是另一条通道，
 * 仍由遥测台发布、在「更多 → 查看公告」查看，本页不掺进来。
 *
 * 编辑器口径（2026-09-24）：
 * - 正文用 Markdown（推荐），支持插入图片（图片存学校库，正文只保存同源地址）；
 * - 三种大屏样式，右侧实时预览与教室大屏用同一个组件渲染；
 * - 发送前先弹「预览 + 确认」，确认后才真正下发。
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
  const [draftError, setDraftError] = useState('');
  const [imageBusy, setImageBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const [filters, setFilters] = useState<{
    status: AnnouncementStatus | 'all';
    level: AnnouncementLevel | 'all';
    scope: AnnouncementScopeType | 'any';
  }>({ status: 'active', level: 'all', scope: 'any' });
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [stats, setStats] = useState<AnnouncementStats | null>(null);
  const [statsDays, setStatsDays] = useState(7);
  const [templates, setTemplates] = useState<AnnouncementTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [items, setItems] = useState<SchoolExamAnnouncement[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [revokingId, setRevokingId] = useState('');
  const [receiptsFor, setReceiptsFor] = useState<SchoolExamAnnouncement | null>(null);

  const query: SchoolAnnouncementQuery = useMemo(
    () => ({ status: filters.status, level: filters.level, scope: filters.scope, q: search, limit: PAGE_SIZE }),
    [filters, search],
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

  // 搜索框打字防抖：400ms 后才真正查库，避免每敲一个字都打一次接口。
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  /** 近 N 天概览（跨公告统计）：进页面、切天数、发完公告后刷新。 */
  const loadStats = useCallback(
    async (days = statsDays) => {
      try {
        setStats(await fetchAnnouncementStats(days));
      } catch {
        // 统计是辅助信息，读不到就不显示，不打扰主流程。
        setStats(null);
      }
    },
    [statsDays],
  );

  useEffect(() => {
    void loadStats(statsDays);
  }, [loadStats, statsDays]);

  useEffect(() => {
    void fetchAnnouncementTemplates()
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }, []);

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

  /** 在光标处插入 Markdown 片段；有选中文本时用它替换选中内容。 */
  const insertMarkdown = (before: string, after = '', placeholder = '') => {
    const element = bodyRef.current;
    if (!element) return;
    const start = element.selectionStart ?? draft.body.length;
    const end = element.selectionEnd ?? start;
    const selected = draft.body.slice(start, end) || placeholder;
    const next = `${draft.body.slice(0, start)}${before}${selected}${after}${draft.body.slice(end)}`;
    setDraft((current) => ({ ...current, body: next }));
    const caret = start + before.length + selected.length;
    window.requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(caret, caret);
    });
  };

  /** 行级语法（标题 / 列表）：必要时先补一个换行，避免粘在上一段末尾。 */
  const insertParagraph = (prefix: string, placeholder: string) => {
    const element = bodyRef.current;
    const start = element?.selectionStart ?? draft.body.length;
    const needsBreak = start > 0 && !draft.body.slice(0, start).endsWith('\n');
    insertMarkdown(`${needsBreak ? '\n' : ''}${prefix}`, '', placeholder);
  };

  const chooseImage = () => imageInputRef.current?.click();

  const onImageChosen = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // 清空 value:同一张图连续插入两次也能再次触发 change。
    event.target.value = '';
    if (!file) return;
    if (!isAnnouncementImageType(file.type)) {
      setDraftError('图片只支持 PNG、JPG、WEBP、GIF。');
      return;
    }
    if (file.size > ANNOUNCEMENT_IMAGE_MAX_BYTES) {
      setDraftError('图片不能超过 2MB。');
      return;
    }
    setImageBusy(true);
    setDraftError('');
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const uploaded = await uploadSchoolAnnouncementImage({
        filename: file.name,
        mimeType: file.type,
        base64: dataUrl,
      });
      const needsBreak = draft.body.length > 0 && !draft.body.endsWith('\n');
      insertMarkdown(`${needsBreak ? '\n' : ''}![${file.name}](${uploaded.url})\n`);
      notify('success', '图片已插入正文，可在右侧预览里确认。', '图片已上传');
    } catch (cause) {
      setDraftError(formatApiError(cause, '图片上传失败'));
    } finally {
      setImageBusy(false);
    }
  };

  /** 点「预览并发送」先校验，再弹预览+确认窗；真正下发在 publish()。 */
  const beginPublish = () => {
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
    setDraftError('');
    setConfirmOpen(true);
  };

  /** 套用常用模板：只带标题/正文/样式/级别，范围与有效期保持当前设置。 */
  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const template = templates.find((item) => item.id === id);
    if (!template) return;
    setDraft((current) => ({
      ...current,
      title: template.title,
      body: template.body,
      style: template.style,
      level: template.level,
    }));
    setDraftError('');
  };

  const saveTemplate = async () => {
    if (!draft.title.trim() && !draft.body.trim()) {
      setDraftError('先把标题或内容写好，再存成模板。');
      return;
    }
    try {
      await saveAnnouncementTemplate({
        title: draft.title.trim() || '未命名模板',
        body: draft.body.trim(),
        style: draft.style,
        level: draft.level,
      });
      setTemplates(await fetchAnnouncementTemplates());
      notify('success', '已存为常用模板，下次发布可以直接套用。', '模板已保存');
    } catch (cause) {
      setDraftError(formatApiError(cause, '模板保存失败'));
    }
  };

  const removeTemplate = async () => {
    if (!templateId) return;
    const confirmed = await confirmDialog({
      title: '删除模板',
      message: '删除后不影响已经发出去的公告。',
      tone: 'warning',
      confirmLabel: '删除',
    });
    if (!confirmed) return;
    try {
      await deleteAnnouncementTemplate(templateId);
      setTemplates(await fetchAnnouncementTemplates());
      setTemplateId('');
      notify('success', '模板已删除。', '已删除');
    } catch (cause) {
      setDraftError(formatApiError(cause, '模板删除失败'));
    }
  };

  const publish = async () => {
    setSending(true);
    setDraftError('');
    try {
      await sendExamAnnouncement({
        title: draft.title.trim(),
        body: draft.body.trim(),
        level: draft.level,
        style: draft.style,
        silent: draft.silent,
        scopeType: draft.scope,
        scopeIds: draft.scope === 'all' ? [] : scopeIdsForSend,
        expiresInMinutes: Number(draft.expiry),
      });
      notify(
        'success',
        `公告已发送到 ${scopeSummary}，教室大屏 1 分钟内更新。`,
        draft.level === 'urgent' ? '紧急公告已发送' : '公告已发送',
      );
      setConfirmOpen(false);
      resetDraft();
      void loadStats();
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

  return (
    <main className="school-announcements">
      <div className="device-status__heading">
        <div>
          <h2>
            <span className="with-help-tip">
              公告
              <HelpTip title="学校公告与作者端公告">
                这里是学校自己发的公告，会下发到所选范围的教室大屏；正文支持 Markdown 与图片，可选三种大屏样式，
                发送前会先给你看预览。紧急公告置顶且不能关闭。作者端统一公告由遥测台发布，可在「更多 →
                查看公告」里查看。
              </HelpTip>
            </span>
          </h2>
          <p>发布、查看和撤回学校公告；生效中的公告会在大屏上展示，大屏每分钟拉取一次。</p>
        </div>
        <RefreshButton className="admin-btn" busy={listLoading} onRefresh={() => void load()} title="刷新公告列表" />
      </div>

      <section className="sann-card">
        <header className="sann-card__head">
          <h3>公告概览</h3>
          <div className="sann-filters">
            <InlineSelect
              value={String(statsDays)}
              ariaLabel="统计区间"
              onChange={(value) => setStatsDays(value === '30' ? 30 : 7)}
              options={[
                { value: '7', label: '近 7 天' },
                { value: '30', label: '近 30 天' },
              ]}
            />
          </div>
        </header>
        {!stats ? (
          <div className="sann-empty">统计加载中…</div>
        ) : (
          <>
            <div className="sann-stats">
              <div>
                <span>公告</span>
                <strong>{stats.announcements}</strong>
                <small>条</small>
              </div>
              <div className="is-primary">
                <span>平均回执率</span>
                <strong>{stats.target > 0 ? Math.round((stats.seen / stats.target) * 100) : 0}</strong>
                <small>%</small>
              </div>
              <div>
                <span>已送达</span>
                <strong>{stats.delivered}</strong>
                <small>台次</small>
              </div>
              <div>
                <span>覆盖教室</span>
                <strong>{stats.devices}</strong>
                <small>台</small>
              </div>
            </div>
            {stats.daily.some((day) => day.announcements > 0) && (
              <div className="sann-spark" role="img" aria-label={`近 ${stats.days} 天每天发布的公告数`}>
                {stats.daily.map((day) => {
                  const peak = Math.max(...stats.daily.map((item) => item.announcements), 1);
                  const rate = day.target > 0 ? Math.round((day.seen / day.target) * 100) : 0;
                  return (
                    <span
                      key={day.date}
                      title={`${day.date}：${day.announcements} 条 · 回执率 ${rate}%`}
                      style={{ height: `${Math.max(6, (day.announcements / peak) * 100)}%` }}
                      className={day.announcements > 0 ? 'is-active' : undefined}
                    />
                  );
                })}
              </div>
            )}
            {stats.lowest.filter((item) => item.seen < item.target).length > 0 && (
              <div className="sann-lowest">
                <span className="sann-note">回执率最低：</span>
                {stats.lowest
                  .filter((item) => item.seen < item.target)
                  .slice(0, 3)
                  .map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        const target = items.find((row) => row.id === item.id);
                        if (target) setReceiptsFor(target);
                      }}
                      title="查看这条公告的回执明细"
                    >
                      {item.title || '无标题'} {item.seen}/{item.target}
                    </button>
                  ))}
              </div>
            )}
          </>
        )}
      </section>

      <section className="sann-card">
        <header className="sann-card__head">
          <h3>
            <Megaphone aria-hidden="true" />
            发布公告
          </h3>
          {canSend ? (
            <div className="sann-template">
              <InlineSelect
                value={templateId}
                ariaLabel="套用常用模板"
                onChange={applyTemplate}
                options={[
                  { value: '', label: '套用模板…' },
                  ...templates.map((item) => ({ value: item.id, label: item.title || '未命名模板' })),
                ]}
              />
              <button className="admin-btn admin-btn--ghost" type="button" onClick={() => void saveTemplate()}>
                存为模板
              </button>
              {templateId && (
                <button className="admin-btn admin-btn--ghost" type="button" onClick={() => void removeTemplate()}>
                  删除模板
                </button>
              )}
            </div>
          ) : (
            <span className="sann-note">当前账号只能查看，发送需要「编辑大型考试」权限。</span>
          )}
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
            <div className="sann-editor">
              <div className="sann-editor__bar">
                <span className="sann-editor__label">正文</span>
                <div className="sann-editor__tools">
                  <button
                    type="button"
                    className="sann-tool"
                    disabled={!canSend || sending}
                    title="插入标题（## ）"
                    onClick={() => insertParagraph('## ', '小标题')}
                  >
                    <Type size={16} aria-hidden="true" />
                    标题
                  </button>
                  <button
                    type="button"
                    className="sann-tool"
                    disabled={!canSend || sending}
                    title="加粗（**）"
                    onClick={() => insertMarkdown('**', '**', '加粗文字')}
                  >
                    <Bold size={16} aria-hidden="true" />
                    加粗
                  </button>
                  <button
                    type="button"
                    className="sann-tool"
                    disabled={!canSend || sending}
                    title="列表（- ）"
                    onClick={() => insertParagraph('- ', '列表项')}
                  >
                    <List size={16} aria-hidden="true" />
                    列表
                  </button>
                  <button
                    type="button"
                    className="sann-tool"
                    disabled={!canSend || sending || imageBusy}
                    title="上传并插入图片（≤2MB，PNG/JPG/WEBP/GIF）"
                    onClick={chooseImage}
                  >
                    <ImagePlus size={16} aria-hidden="true" />
                    {imageBusy ? '上传中…' : '插入图片'}
                  </button>
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    hidden
                    onChange={(event) => void onImageChosen(event)}
                  />
                </div>
              </div>
              <textarea
                ref={bodyRef}
                className="admin-input sann-editor__input"
                rows={10}
                value={draft.body}
                maxLength={ANNOUNCEMENT_BODY_MAX}
                disabled={!canSend || sending}
                onChange={(event) => setDraft({ ...draft, body: event.target.value })}
                placeholder={'推荐用 Markdown：## 小标题、**加粗**、- 列表；图片点上面的「插入图片」。'}
              />
              <p className="sann-note">Markdown 实时预览在右侧；图片存在学校库里，正文只保存同源地址。</p>
            </div>
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
            <div className="sann-compose__row">
              <label className="admin-label">
                弹出方式
                <InlineSelect
                  value={draft.silent ? 'silent' : 'auto'}
                  disabled={!canSend || sending}
                  onChange={(value) => setDraft({ ...draft, silent: value === 'silent' })}
                  options={[
                    { value: 'auto', label: '自动弹出（推荐）' },
                    { value: 'silent', label: '只进列表（不打扰）' },
                  ]}
                />
              </label>
              <p className="sann-note sann-note--inline">普通公告在 22:00–06:00 不会自动弹出，紧急公告不受影响。</p>
            </div>
            <div className="sann-style-picker">
              <span className="sann-scope-picker__title">大屏样式</span>
              <div className="sann-style-list">
                {ANNOUNCEMENT_STYLES.map((option) => {
                  const active = draft.style === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={`sann-style${active ? ' is-active' : ''}`}
                      aria-pressed={active}
                      disabled={!canSend || sending}
                      onClick={() => setDraft({ ...draft, style: option.value })}
                    >
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </button>
                  );
                })}
              </div>
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
                disabled={!canSend || sending || imageBusy}
                onClick={beginPublish}
              >
                预览并发送
              </button>
              <button className="admin-btn admin-btn--ghost" type="button" disabled={sending} onClick={resetDraft}>
                清空
              </button>
            </div>
          </div>
          <aside className="sann-preview">
            <div className="sann-preview__head">
              教室大屏预览 · {ANNOUNCEMENT_STYLE_LABELS[draft.style]} · {scopeSummary}
            </div>
            <div className="sann-preview__screen">
              <SchoolAnnouncementCard item={draft} />
            </div>
          </aside>
        </div>
      </section>

      <section className="sann-card">
        <header className="sann-card__head">
          <h3>公告记录</h3>
          <div className="sann-filters">
            <input
              className="admin-input sann-search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="搜索标题或内容"
              aria-label="搜索公告"
            />
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
                    <span className="sann-badge">{ANNOUNCEMENT_STYLE_LABELS[item.style]}</span>
                    {/* 回执徽标：已读设备数 / 应达设备数（设备口径，≥3 秒算已读）。 */}
                    <span
                      className={`sann-badge${
                        item.targetCount && item.seenCount === item.targetCount ? ' is-active' : ''
                      }`}
                      title={`已送达 ${item.deliveredCount ?? 0} 台 · 应达 ${item.targetCount ?? 0} 台`}
                    >
                      已读 {item.seenCount ?? 0}/{item.targetCount ?? 0}
                    </span>
                  </div>
                  {item.body.trim() && (
                    <div
                      className="sann-item__body md-body"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(item.body) }}
                    />
                  )}
                  <div className="sann-item__meta">
                    <span>{audienceLabel(item)}</span>
                    <span>发送 {formatDateTimeInZone(item.createdAt)}</span>
                    <span>{item.expiresAt ? `有效至 ${formatDateTimeInZone(item.expiresAt)}` : '不过期'}</span>
                    {item.examId && <span>关联考试 {item.examId}</span>}
                  </div>
                </div>
                <div className="sann-item__actions">
                  <button
                    className="admin-btn admin-btn--ghost"
                    type="button"
                    onClick={() => setReceiptsFor(item)}
                    title="查看这条公告在哪些教室看过、哪些还没看"
                  >
                    回执
                  </button>
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
                </div>
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

      {confirmOpen && (
        <SchoolAnnouncementPublishDialog
          draft={{ title: draft.title.trim(), body: draft.body.trim(), level: draft.level, style: draft.style }}
          audience={scopeSummary}
          expiryLabel={draft.expiry === '0' ? '不过期（需要手动撤回）' : `展示 ${expiryLabel}`}
          delivery={
            draft.silent
              ? '只进公告列表，不自动弹出'
              : draft.level === 'urgent'
                ? '自动弹出（紧急公告随时弹，不受夜间静默限制）'
                : '自动弹出（普通公告 22:00–06:00 不弹）'
          }
          busy={sending}
          error={draftError}
          onConfirm={() => void publish()}
          onCancel={() => {
            if (sending) return;
            setConfirmOpen(false);
          }}
        />
      )}

      {receiptsFor && (
        <SchoolAnnouncementReceiptsDialog
          announcementId={receiptsFor.id}
          title={receiptsFor.title}
          canRemind={canSend}
          onClose={() => setReceiptsFor(null)}
        />
      )}
    </main>
  );
}
