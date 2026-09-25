import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import type { ScheduleMode, WeeklyWeekMode } from '../types/exam';
import { getShanghaiDateKey } from '../utils/weeklySchedule';
import { buildInitializationData, type InitializationResult, type SchoolDraftRow } from '../utils/initializationData';
import { CHINA_PROVINCES, schoolFullName } from '../data/provinces';
import { fetchAnnouncements, type Announcement } from '../services/announcements';
import { renderMarkdown } from '../utils/renderMarkdown';
import InlineSelect from './InlineSelect';
import { DateTimeField } from './touch-datetime-picker';
import AdminWizardSteps from './AdminWizardSteps';
import '../styles/initialization-wizard.css';
import '../styles/settings.css';
import EmailServicePanel, { type EmailServicePanelHandle } from './EmailServicePanel';

export type InitializationPasswordChange = { currentPassword: string; newPassword: string };
export type InitializationCompletion = { ok: boolean; error?: string; recoveryKey?: string };
interface Props {
  open: boolean;
  onClose: () => void;
  onComplete: (
    result: InitializationResult,
    password: InitializationPasswordChange,
  ) => Promise<InitializationCompletion>;
  onFinalized: () => void;
}

export default function InitializationWizard({ open, onClose, onComplete, onFinalized }: Props) {
  const [step, setStep] = useState(0);
  const [mode] = useState<'blank' | 'demo'>('blank');
  const [schoolName, setSchoolName] = useState('');
  const [province, setProvince] = useState('');
  const [school, setSchool] = useState<SchoolDraftRow[]>([{ name: '高一', classes: '1班' }]);
  const [quickCounts, setQuickCounts] = useState<Record<number, string>>({ 0: '10' });
  const [termStart, setTermStart] = useState(getShanghaiDateKey(Date.now()));
  const [weekMode, setWeekMode] = useState<WeeklyWeekMode>('ab');
  const [excludeOfficialHolidays, setExcludeOfficialHolidays] = useState(true);
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('automatic');
  const [logoDataUrl, setLogoDataUrl] = useState('');
  const [logoError, setLogoError] = useState('');
  const [seoDraft, setSeoDraft] = useState({ titleSuffix: '', description: '', keywords: '', siteUrl: '' });
  const [subjectTrackMode, setSubjectTrackMode] = useState(false);
  const [docReadConfirmed, setDocReadConfirmed] = useState(false);
  const [docHint, setDocHint] = useState('');
  const [documents, setDocuments] = useState<Announcement[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentsError, setDocumentsError] = useState('');
  const [_documentGateEntered, setDocumentGateEntered] = useState(false);
  const [readingStartedAt, setReadingStartedAt] = useState<number | null>(null);
  const [_readingRemaining, setReadingRemaining] = useState(10);
  const [documentRead, setDocumentRead] = useState(false);
  const [passwordDraft, setPasswordDraft] = useState({ current: '', next: '', confirm: '' });
  const [passwordError, setPasswordError] = useState('');
  const [finishing, setFinishing] = useState(false);
  const [emailSaving, setEmailSaving] = useState(false);
  const emailPanelRef = useRef<EmailServicePanelHandle | null>(null);
  const [recoveryKey, setRecoveryKey] = useState('');
  const [recoverySaved, setRecoverySaved] = useState(false);
  const [copyState, setCopyState] = useState('');
  const validSchool = useMemo(() => school.some((row) => row.name.trim() && row.classes.trim()), [school]);
  const safeDocumentUrl = (value?: string) => {
    try {
      const url = new URL(value ?? '');
      return url.protocol === 'https:' ? url.toString() : '';
    } catch {
      return '';
    }
  };
  const startReading = () => {
    if (!readingStartedAt) {
      setReadingStartedAt(Date.now());
      setReadingRemaining(10);
    }
  };
  const onLogoFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setLogoError('图片不能超过 2MB');
      return;
    }
    setLogoError('');
    const reader = new FileReader();
    reader.onload = () => setLogoDataUrl(String(reader.result ?? ''));
    reader.readAsDataURL(file);
  };
  const validDocuments = useMemo(() => documents.filter((item) => safeDocumentUrl(item.url)), [documents]);
  const canDismiss = false;

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setDocumentsLoading(true);
    setDocumentsError('');
    fetchAnnouncements(true)
      .then((items) => {
        if (!alive) return;
        const docs = items.filter((item) => item.type === 'document');
        setDocuments(docs);
        if (!docs.some((item) => safeDocumentUrl(item.url)))
          setDocumentsError('当前没有可打开的 HTTPS 使用文档，请检查作者端公告后重试。');
      })
      .catch(() => {
        if (alive) setDocumentsError('使用文档加载失败，请检查网络后重试。');
      })
      .finally(() => {
        if (alive) setDocumentsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open]);

  useEffect(() => {
    if (!readingStartedAt || documentRead) return;
    const update = () => {
      const remaining = Math.max(0, Math.ceil((10_000 - (Date.now() - readingStartedAt)) / 1000));
      setReadingRemaining(remaining);
      if (remaining === 0) setDocumentRead(true);
    };
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [readingStartedAt, documentRead]);

  if (!open) return null;

  const quickClasses = (index: number, count: number) =>
    setSchool((list) =>
      list.map((row, rowIndex) =>
        rowIndex === index
          ? {
              ...row,
              classes: Array.from({ length: Math.max(1, Math.min(99, count)) }, (_, i) => `${i + 1}班`).join('、'),
            }
          : row,
      ),
    );
  const finish = async () => {
    if (!passwordDraft.current) {
      setPasswordError('请输入当前超级管理员密码');
      return;
    }
    if (passwordDraft.next.length < 8) {
      setPasswordError('新密码至少需要 8 位');
      return;
    }
    if (passwordDraft.next === passwordDraft.current) {
      setPasswordError('新密码不能与当前密码相同');
      return;
    }
    if (passwordDraft.next !== passwordDraft.confirm) {
      setPasswordError('两次输入的新密码不一致');
      return;
    }
    setFinishing(true);
    setPasswordError('');
    try {
      const result = await onComplete(
        buildInitializationData({
          mode,
          province,
          schoolName,
          school,
          termStart,
          weekMode,
          excludeOfficialHolidays,
          scheduleMode,
          schoolLogo: logoDataUrl,
          subjectTrackModeEnabled: subjectTrackMode,
          seo: seoDraft,
        }),
        { currentPassword: passwordDraft.current, newPassword: passwordDraft.next },
      );
      if (!result.ok) setPasswordError(result.error || '初始化未完成，请重试');
      else if (result.recoveryKey) {
        setRecoveryKey(result.recoveryKey);
        setRecoverySaved(false);
        setStep(7);
      } else onFinalized();
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : '初始化服务暂时不可用，请检查网络后重试');
    } finally {
      setFinishing(false);
    }
  };
  const enterDocumentStep = () => {
    setDocumentGateEntered(true);
    setDocHint('');
    setStep(5);
  };
  const openDocument = (document: Announcement) => {
    const url = safeDocumentUrl(document.url);
    if (!url) {
      setDocumentsError('该文档链接无效，必须使用 HTTPS 地址。');
      return;
    }
    const opened = window.open(url, '_blank');
    if (!opened) {
      setDocumentsError('浏览器阻止了文档窗口。无需修改弹窗设置，可稍后从“系统公告 → 文档”手动获取链接。');
      return;
    }
    opened.opener = null;
    setDocumentsError('');
    startReading();
  };
  const copyRecoveryKey = async () => {
    try {
      await navigator.clipboard.writeText(recoveryKey);
      setCopyState('已复制');
    } catch {
      setCopyState('复制失败，请手动选择密钥');
    }
  };

  return (
    <div className="init-overlay" role="dialog" aria-modal="true" aria-labelledby="init-title">
      <div className="init-window">
        <header className="init-head">
          <div>
            <span>初始化向导 · {step + 1}/8</span>
            <h2 id="init-title">
              {
                [
                  '填写学校信息',
                  '设置年级与班级',
                  '设置学期规则',
                  '邮件服务（可选）',
                  '确认学校配置',
                  '查看使用文档',
                  '修改超级管理员密码',
                  '保存超级管理员恢复密钥',
                ][step]
              }
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={!canDismiss || finishing}
            title="请完成初始化流程，不能中途跳过"
            aria-label="初始化流程完成前不可关闭"
          >
            ×
          </button>
        </header>
        <div className="init-workspace">
          <AdminWizardSteps
            active={step}
            steps={[
              { label: '学校信息' },
              { label: '年级班级' },
              { label: '学期规则' },
              { label: '邮件服务' },
              { label: '确认配置' },
              { label: '使用文档' },
              { label: '管理员密码' },
              { label: '恢复密钥' },
            ]}
            summary={
              <>
                <span>当前学校</span>
                <strong>{schoolFullName(province, schoolName) || '尚未填写'}</strong>
                <span>{school.filter((row) => row.name.trim()).length} 个年级</span>
              </>
            }
          />
          <main className="init-body">
            {step === 0 && (
              <div className="init-form">
                <label>
                  <span>省份 / 地区</span>
                  <InlineSelect
                    className="init-inline-select"
                    value={province}
                    onChange={setProvince}
                    options={[
                      { value: '', label: '请选择省份或地区' },
                      ...CHINA_PROVINCES.map((item) => ({ value: item, label: item })),
                    ]}
                  />
                </label>
                <label>
                  <span>学校名称</span>
                  <input
                    value={schoolName}
                    onChange={(event) => setSchoolName(event.target.value)}
                    placeholder="如：第一中学"
                    maxLength={80}
                  />
                </label>
                <div className="init-seo">
                  <strong>学校图标（可选）</strong>
                  <div className="init-logo-row">
                    {logoDataUrl ? (
                      <img className="init-logo-preview" src={logoDataUrl} alt="学校图标" />
                    ) : (
                      <>
                        <span className="init-logo-empty" aria-hidden="true">
                          <ImagePlus size={18} />
                        </span>
                        <span className="init-logo-empty-text">未上传</span>
                      </>
                    )}
                    <label className="init-logo-upload">
                      <input type="file" accept="image/*" onChange={(event) => onLogoFile(event.target.files?.[0])} />
                      <ImagePlus size={14} aria-hidden="true" />
                      上传图标
                    </label>
                    {logoDataUrl && (
                      <button type="button" className="init-logo-remove" onClick={() => setLogoDataUrl('')}>
                        移除
                      </button>
                    )}
                  </div>
                  {logoError && <p className="init-note">{logoError}</p>}
                  <strong>站点信息（SEO，可选）</strong>
                  <label>
                    <span>浏览器标题后缀</span>
                    <input
                      value={seoDraft.titleSuffix}
                      onChange={(event) => setSeoDraft((value) => ({ ...value, titleSuffix: event.target.value }))}
                      placeholder="如：考试看板"
                      maxLength={60}
                    />
                  </label>
                  <label>
                    <span>SEO 描述</span>
                    <input
                      value={seoDraft.description}
                      onChange={(event) => setSeoDraft((value) => ({ ...value, description: event.target.value }))}
                      placeholder="一句话介绍本校考试看板，将用于搜索引擎描述"
                      maxLength={200}
                    />
                  </label>
                  <label>
                    <span>关键词</span>
                    <input
                      value={seoDraft.keywords}
                      onChange={(event) => setSeoDraft((value) => ({ ...value, keywords: event.target.value }))}
                      placeholder="学校名称, 考试安排, 教室大屏"
                      maxLength={120}
                    />
                  </label>
                  <label>
                    <span>站点公开地址</span>
                    <input
                      value={seoDraft.siteUrl}
                      onChange={(event) => setSeoDraft((value) => ({ ...value, siteUrl: event.target.value }))}
                      placeholder="https://exam.example.edu.cn（用于搜索引擎收录，可稍后修改）"
                      maxLength={200}
                    />
                  </label>
                </div>
                <div className="init-school-fullname">
                  <span>完整校名</span>
                  <strong>{schoolFullName(province, schoolName) || '选择省份并填写学校名称后自动生成'}</strong>
                </div>
                <p className="init-note">
                  完整校名将显示在考试安排预览和 A4 PDF 中，并在你同意遥测后与省份一起上报作者端。
                </p>
              </div>
            )}
            {step === 1 && (
              <div className="init-school">
                <p>每行对应一个年级。每一行都可独立输入数量并生成 1 班至 X 班。</p>
                {school.map((row, index) => (
                  <div className="init-school-row" key={`grade-row-${index}`}>
                    <input
                      value={row.name}
                      onChange={(event) =>
                        setSchool((list) =>
                          list.map((item, i) => (i === index ? { ...item, name: event.target.value } : item)),
                        )
                      }
                      placeholder="年级，如：高一"
                    />
                    <input
                      value={row.classes}
                      onChange={(event) =>
                        setSchool((list) =>
                          list.map((item, i) => (i === index ? { ...item, classes: event.target.value } : item)),
                        )
                      }
                      placeholder="班级，如：1班、2班"
                    />
                    <label className="init-quick-count">
                      <input
                        type="number"
                        min="1"
                        max="99"
                        value={quickCounts[index] ?? '10'}
                        onChange={(event) => setQuickCounts((value) => ({ ...value, [index]: event.target.value }))}
                        aria-label={`${row.name || '当前年级'}班级数量`}
                      />
                      <button type="button" onClick={() => quickClasses(index, Number(quickCounts[index] || 10))}>
                        生成 1-X 班
                      </button>
                    </label>
                    <button
                      type="button"
                      onClick={() => setSchool((list) => list.filter((_, i) => i !== index))}
                      aria-label="删除此年级"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="init-add"
                  onClick={() => {
                    const index = school.length;
                    setSchool((list) => [...list, { name: '', classes: '' }]);
                    setQuickCounts((value) => ({ ...value, [index]: '10' }));
                  }}
                >
                  添加年级
                </button>
              </div>
            )}
            {step === 2 && (
              <div className="init-form">
                <label>
                  <span>学期开始日期</span>
                  <DateTimeField
                    className="init-date-time-field"
                    value={termStart}
                    onChange={setTermStart}
                    mode="date"
                    title="选择学期开始日期"
                    showFieldPreview={false}
                  />
                </label>
                <label>
                  <span>周次模式</span>
                  <InlineSelect
                    className="init-inline-select"
                    value={weekMode}
                    onChange={(value) => setWeekMode(value as WeeklyWeekMode)}
                    options={[
                      { value: 'single', label: '统一周表' },
                      { value: 'ab', label: 'A/B 周交替' },
                    ]}
                  />
                </label>
                <label className="init-check">
                  <input
                    type="checkbox"
                    checked={excludeOfficialHolidays}
                    onChange={(event) => setExcludeOfficialHolidays(event.target.checked)}
                  />
                  <span className="init-check__text">
                    <strong>自动排除法定节假日</strong>
                    <small>生成周测计划和日历预览时自动跳过系统内置的法定节假日。</small>
                  </span>
                </label>
                <label>
                  <span>默认运行模式</span>
                  <InlineSelect
                    className="init-inline-select"
                    value={scheduleMode}
                    onChange={(value) => setScheduleMode(value as ScheduleMode)}
                    options={[
                      { value: 'major-only', label: '仅大型考试' },
                      { value: 'weekly-only', label: '仅周测' },
                      { value: 'automatic', label: '自动调度' },
                    ]}
                  />
                </label>
                <label className="init-check">
                  <input
                    type="checkbox"
                    checked={subjectTrackMode}
                    onChange={(event) => setSubjectTrackMode(event.target.checked)}
                  />
                  <span className="init-check__text">
                    <strong>分科模式</strong>
                    <small>
                      开启后已分科班级按选科过滤，未分科班级读取全部 9 门；关闭后所有科目按考试范围直接下发。默认关闭。
                    </small>
                  </span>
                </label>
              </div>
            )}
            {step === 3 && (
              <div className="init-email">
                <p>
                  配置 SMTP 后，管理员可使用邮箱验证码登录与绑定邮箱。此步骤可选，可跳过，稍后在“系统设置 →
                  邮件服务”中再配置。
                </p>
                <EmailServicePanel ref={emailPanelRef} canEditSettings />
              </div>
            )}
            {step === 4 && (
              <div className="init-summary">
                <strong>{schoolFullName(province, schoolName)}</strong>
                <p>
                  {school.filter((row) => row.name.trim()).length} 个年级 · 学期开始于 {termStart} ·{' '}
                  {weekMode === 'ab' ? 'A/B 周交替' : '统一周表'} ·{' '}
                  {scheduleMode === 'automatic' ? '自动调度' : scheduleMode === 'weekly-only' ? '仅周测' : '仅大型考试'}
                </p>
                <small>完成后客户端回到首页选择年级和班级，不会在首次打开首页时被强制拦截。</small>
              </div>
            )}
            {step === 5 && (
              <div className="init-documents">
                <p className="init-documents__lead">
                  建议在继续前查看使用文档。此步骤不强制打开链接；若浏览器阻止弹窗，可稍后从“系统公告 → 文档”手动获取。
                </p>
                {documentsLoading ? (
                  <div className="init-documents__state">正在加载文档…</div>
                ) : validDocuments.length ? (
                  <>
                    <div className="init-documents__list">
                      {validDocuments.map((document) => (
                        <article key={document.id}>
                          <div>
                            <strong>{document.title || '使用文档'}</strong>
                            {document.summary && (
                              <div
                                className="md-body"
                                dangerouslySetInnerHTML={{ __html: renderMarkdown(document.summary) }}
                              />
                            )}
                          </div>
                          <button type="button" onClick={() => openDocument(document)}>
                            {document.buttonLabel?.trim() || '打开文档'} ↗
                          </button>
                        </article>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="init-documents__state">暂时没有可用文档，可继续初始化并稍后在系统公告中查看。</div>
                )}
                {docHint && (
                  <p className="init-documents__error" role="alert">
                    {docHint}
                  </p>
                )}
                <label className="init-check init-documents__confirm">
                  <input
                    type="checkbox"
                    checked={docReadConfirmed}
                    onChange={(event) => setDocReadConfirmed(event.target.checked)}
                  />
                  <span className="init-check__text">
                    <strong>我已打开文档并停留至少 10 秒</strong>
                    <small>未勾选时下一步会提示一次，仍可跳过。</small>
                  </span>
                </label>
                {documentsError && <p className="init-documents__error">{documentsError}</p>}
                {(documentRead || docReadConfirmed) && (
                  <div className="init-documents__done">
                    <strong>已查看文档</strong>
                    <span>
                      今后可从“首页 → 系统公告 → 文档”，或“管理后台 → 更多 → 查看公告 → 文档”再次查找使用文档。
                    </span>
                  </div>
                )}
              </div>
            )}
            {step === 6 && (
              <div className="init-password">
                <p>设置新的超级管理员密码。保存成功后当前账号会退出，需要使用新密码重新登录。</p>
                {passwordError && (
                  <div className="init-documents__error" role="alert">
                    {passwordError}
                  </div>
                )}
                <div className="init-form">
                  <label>
                    <span>当前密码</span>
                    <input
                      type="password"
                      autoComplete="current-password"
                      value={passwordDraft.current}
                      onChange={(event) => {
                        setPasswordError('');
                        setPasswordDraft((value) => ({ ...value, current: event.target.value }));
                      }}
                      placeholder="验证当前超级管理员身份"
                    />
                  </label>
                  <label>
                    <span>新密码</span>
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={passwordDraft.next}
                      onChange={(event) => {
                        setPasswordError('');
                        setPasswordDraft((value) => ({ ...value, next: event.target.value }));
                      }}
                      placeholder="至少 8 位，不能与当前密码相同"
                    />
                  </label>
                  <label>
                    <span>确认新密码</span>
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={passwordDraft.confirm}
                      onChange={(event) => {
                        setPasswordError('');
                        setPasswordDraft((value) => ({ ...value, confirm: event.target.value }));
                      }}
                      placeholder="再次输入新密码"
                    />
                  </label>
                </div>
                <small>密码只会通过加密连接提交到当前部署，不会写入浏览器本地设置、公告或遥测数据。</small>
              </div>
            )}
            {step === 7 && (
              <div className="init-recovery">
                <div className="init-recovery__warning">
                  <strong>恢复密钥只显示这一次</strong>
                  <span>
                    当所有超级管理员都忘记密码时，可在登录页使用此密钥重置指定超级管理员密码。它不能用于日常登录。
                  </span>
                </div>
                <label className="init-recovery__key">
                  <span>超级管理员恢复密钥</span>
                  <textarea
                    readOnly
                    value={recoveryKey}
                    onFocus={(event) => event.currentTarget.select()}
                    aria-label="超级管理员恢复密钥"
                  />
                </label>
                <button type="button" className="init-recovery__copy" onClick={() => void copyRecoveryKey()}>
                  {copyState || '复制恢复密钥'}
                </button>
                <ul>
                  <li>保存到可信密码管理器或学校受控的离线介质。</li>
                  <li>不要发送给年级管理员、班级管理员，也不要粘贴到公开反馈或截图中。</li>
                  <li>数据库仅保存密钥哈希，系统之后无法再次显示这段明文。</li>
                </ul>
                <label className="init-check init-recovery__confirm">
                  <input
                    type="checkbox"
                    checked={recoverySaved}
                    onChange={(event) => setRecoverySaved(event.target.checked)}
                  />
                  <span className="init-check__text">
                    <strong>我已安全保存恢复密钥</strong>
                    <small>我了解密钥遗失后系统无法再次显示原文。</small>
                  </span>
                </label>
              </div>
            )}
          </main>
        </div>
        <footer className="init-actions">
          {step > 0 && step < 7 && (
            <button disabled={finishing} onClick={() => setStep((value) => value - 1)}>
              上一步
            </button>
          )}
          <button
            className="is-primary"
            disabled={
              finishing ||
              emailSaving ||
              (step === 0 && (!province || !schoolName.trim())) ||
              (step === 1 && !validSchool) ||
              (step === 7 && !recoverySaved)
            }
            onClick={() => {
              if (step === 3) {
                setEmailSaving(true);
                void (async () => {
                  try {
                    const result = await emailPanelRef.current?.saveIfConfigured();
                    if (result === 'error') return;
                    setStep(4);
                  } finally {
                    setEmailSaving(false);
                  }
                })();
                return;
              }
              if (step < 4) {
                setStep((value) => value + 1);
                return;
              }
              if (step === 4) {
                enterDocumentStep();
                return;
              }
              if (step === 5) {
                if (!documentRead && !docReadConfirmed) {
                  setDocHint('请先打开并阅读使用文档（停留 10 秒），或勾选确认；仍可再次点击“继续”跳过。');
                  return;
                }
                setStep(6);
                return;
              }
              if (step === 6) {
                void finish();
                return;
              }
              onFinalized();
            }}
          >
            {step < 4
              ? '下一步'
              : step === 4
                ? '查看使用文档'
                : step === 5
                  ? '继续设置超级管理员密码'
                  : step === 6
                    ? finishing
                      ? '正在保存并修改密码…'
                      : '完成初始化并修改密码'
                    : '我已保存，完成初始化'}
          </button>
        </footer>
      </div>
    </div>
  );
}
