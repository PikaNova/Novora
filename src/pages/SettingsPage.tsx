import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  adminCan,
  getAdminUser,
  hasValidLocalToken,
  isLoginRequired,
  refreshAdminUser,
  type AdminUserContext,
} from '../services/examService';
import BatchPresetSettingsPanel from '../components/BatchPresetSettingsPanel';
import LoadingState from '../components/LoadingState';
import { APP_VERSION } from '../services/telemetry';
import '../styles/settings.css';
import AccessDenied from '../components/AccessDenied';
import AboutSection from '../components/settings/AboutSection';
import AnnouncementsSection from '../components/settings/AnnouncementsSection';
import TelemetrySection from '../components/settings/TelemetrySection';
import DeploymentSection from '../components/settings/DeploymentSection';
import SchoolInfoSection from '../components/settings/SchoolInfoSection';
import EmailServiceSection from '../components/settings/EmailServiceSection';
import WeeklyCalendarSection from '../components/settings/WeeklyCalendarSection';
import SubjectTrackModeSection from '../components/settings/SubjectTrackModeSection';
import TimeSyncSection from '../components/settings/TimeSyncSection';
import AlertsAdvancedSection from '../components/settings/AlertsAdvancedSection';
import DataMaintenanceSection from '../components/settings/DataMaintenanceSection';
import SettingsRail, { type SettingsRailGroup } from '../components/settings/SettingsRail';
import SettingsCollapsibleCard from '../components/settings/SettingsCollapsibleCard';
import SystemStatusSection from '../components/settings/SystemStatusSection';
import DiagnosticLogsSection from '../components/settings/DiagnosticLogsSection';
import { Activity, ArrowLeft, DatabaseZap, Info, ListChecks, Mail, RadioTower, School } from 'lucide-react';

/** 设置分组只剩导航职责，具体权限在下面按分组判定；见 groups 计算。 */
type SettingsGroupId = 'school' | 'account' | 'exam' | 'runtime' | 'release' | 'maintenance' | 'about';

const ABOUT_GROUP: SettingsRailGroup = { id: 'about', label: '关于', icon: <Info size={16} /> };

export default function SettingsPage() {
  const navigate = useNavigate();
  const { group } = useParams<{ group?: string }>();
  // 已有本地令牌时立即展示页面，跳过鉴权网络往返（数据库在新加坡、服务器在美国，
  // 跨洲往返会造成数秒白屏）；无令牌时才等待是否需要登录的判断。
  const [authed, setAuthed] = useState(() => hasValidLocalToken());
  const [adminUser, setAdminUser] = useState<AdminUserContext | null>(() => getAdminUser());
  const [denied, setDenied] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    if (hasValidLocalToken()) {
      refreshAdminUser().then((user) => {
        if (!user) {
          navigate('/login?next=/settings', { replace: true });
          return;
        }
        if (user.mustChangePassword) {
          navigate('/admin?tab=users&password=1', { replace: true });
          return;
        }
        if (!adminCan('settings.read', user)) {
          setAdminUser(user);
          setAuthed(true);
          setDenied(true);
          return;
        }
        setAdminUser(user);
        setAuthed(true);
      });
      return;
    }
    isLoginRequired().then((required) => {
      if (!required) setAuthed(true);
      else navigate('/login?next=/settings', { replace: true });
    });
  }, [navigate]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const canEditSettings = adminUser ? adminCan('settings.edit', adminUser) : !hasValidLocalToken();
  const canEditPresets = adminUser ? adminCan('majorBatch.preset_edit', adminUser) : !hasValidLocalToken();
  const canEditWeekly = adminUser ? adminCan('weekly.edit', adminUser) : !hasValidLocalToken();
  const canReadAlerts = adminUser ? adminCan('alerts.read', adminUser) : !hasValidLocalToken();
  const canEditAlerts = adminUser ? adminCan('alerts.edit', adminUser) : !hasValidLocalToken();
  const canEditSchool = adminUser ? adminCan('initialization.run', adminUser) : !hasValidLocalToken();
  const canResetDatabase = adminUser ? adminUser.permissions.includes('*') : !hasValidLocalToken();
  const canReadDiagnostics = adminUser ? adminCan('diagnostics.read', adminUser) : !hasValidLocalToken();
  const canUploadDiagnostics = adminUser ? adminCan('diagnostics.upload', adminUser) : !hasValidLocalToken();
  const canEditDiagnostics = adminUser ? adminCan('diagnostics.settings', adminUser) : !hasValidLocalToken();
  const hasAnyEditable =
    canEditSettings || canEditPresets || canEditWeekly || canEditAlerts || canEditSchool || canResetDatabase;

  // 分组重排：把原来错位的「系统状态 / 诊断日志 / 版本与更新」放回语义正确的位置，
  // 只展示当前账号有内容可看的分组；about 固定在左栏底部。
  const groups = useMemo<SettingsRailGroup[]>(() => {
    const list: SettingsRailGroup[] = [{ id: 'school', label: '学校与基础', icon: <School size={16} /> }];
    if (canEditSettings || canResetDatabase)
      list.push({ id: 'account', label: '账号与安全', icon: <Mail size={16} /> });
    if (canEditWeekly || canEditSettings || canEditPresets)
      list.push({ id: 'exam', label: '考试与排课', icon: <ListChecks size={16} /> });
    if (canEditSettings || canReadAlerts || canResetDatabase || canReadDiagnostics)
      list.push({ id: 'runtime', label: '运行与诊断', icon: <Activity size={16} /> });
    if (canEditSettings) list.push({ id: 'release', label: '版本与更新', icon: <RadioTower size={16} /> });
    if (canResetDatabase) list.push({ id: 'maintenance', label: '数据与维护', icon: <DatabaseZap size={16} /> });
    return list;
  }, [canEditSettings, canResetDatabase, canEditWeekly, canEditPresets, canReadAlerts, canReadDiagnostics]);
  const availableGroups = useMemo(() => [...groups.map((item) => item.id), ABOUT_GROUP.id], [groups]);
  const activeGroup = (group ?? '') as SettingsGroupId;

  if (!authed) return <LoadingState kind="auth" title="正在获取权限" message="正在确认系统设置权限…" />;
  if (denied) return <AccessDenied moduleName="系统设置" onBack={() => navigate('/admin')} />;
  // 无分组、分组不存在、或该分组对当前账号不可见时，回落到第一个可用分组。
  if (!availableGroups.includes(activeGroup)) {
    return <Navigate to={`/settings/${availableGroups[0]}`} replace />;
  }

  return (
    <div className={'set-page' + (scrolled ? ' is-scrolled' : '')}>
      <header className="set-header">
        <div className="set-header__left">
          <button className="set-back" onClick={() => navigate('/admin')}>
            <ArrowLeft aria-hidden="true" />
            返回管理
          </button>
          <h1 className="set-title">系统设置</h1>
        </div>
        <span className="set-version">v{APP_VERSION}</span>
      </header>

      <div className="set-workspace">
        <SettingsRail
          groups={groups}
          footer={ABOUT_GROUP}
          active={activeGroup}
          onSelect={(id) => navigate(`/settings/${id}`)}
        />
        <div className="set-content">
          {!hasAnyEditable && (
            <div className="set-note set-note--warn">
              当前账号没有可修改的系统设置项，以下仅保留“我的账户/关于”等个人与只读板块。
            </div>
          )}
          {!canEditSettings && (
            <div className="set-note set-note--warn">
              当前账号只能修改已授权的系统设置项，其余全局设置保持只读。如需修改登录密码，请前往“用户与权限”。
            </div>
          )}
          <div className="set-note set-note--local-hint">
            显示风格、动效与字体属于本机偏好，请前往
            <Link to="/local-settings">本地设置</Link>
            调整。
          </div>
          {activeGroup === 'school' && (
            <section id="set-group-school" className="set-group" data-group="school">
              <h2 className="set-group__title">学校与基础</h2>
              <div className="set-group__body">
                {canEditSchool && <SchoolInfoSection canEditSchool={canEditSchool} />}
                <AnnouncementsSection />
              </div>
            </section>
          )}

          {activeGroup === 'account' && (
            <section id="set-group-account" className="set-group" data-group="account">
              <h2 className="set-group__title">登录与账号</h2>
              <div className="set-group__body">
                {(canEditSettings || canResetDatabase) && (
                  <EmailServiceSection canEditSettings={canEditSettings} canEditPolicy={canResetDatabase} />
                )}
              </div>
            </section>
          )}

          {activeGroup === 'exam' && (
            <section id="set-group-exam" className="set-group" data-group="exam">
              <h2 className="set-group__title">考试与排课</h2>
              <div className="set-group__body">
                {canEditWeekly && <WeeklyCalendarSection canEditWeekly={canEditWeekly} adminUser={adminUser} />}
                {canEditSettings && <SubjectTrackModeSection canEditSettings={canEditSettings} />}

                {/* ―― 批量添加分考试预设 ―― */}
                {canEditPresets && (
                  <section className="set-card">
                    <h2 className="set-card__title">
                      <ListChecks size={18} />
                      批量添加分考试预设
                    </h2>
                    <p className="set-note">
                      管理批量添加分考试时可复用的常用科目组和常用时间组，与批量添加弹窗中的设置共享，可在此新建、排序或删除。
                    </p>
                    <BatchPresetSettingsPanel canEdit={canEditPresets} />
                  </section>
                )}
              </div>
            </section>
          )}

          {activeGroup === 'runtime' && (
            <section id="set-group-runtime" className="set-group" data-group="runtime">
              <h2 className="set-group__title">运行与诊断</h2>
              <div className="set-group__body">
                {canEditSettings && <TimeSyncSection canEditSettings={canEditSettings} />}
                {canEditAlerts ? (
                  <AlertsAdvancedSection
                    canReadAlerts={canReadAlerts}
                    canEditAlerts={canEditAlerts}
                    canEditSettings={canEditSettings}
                  />
                ) : null}
                {canResetDatabase && <SystemStatusSection />}
                <DiagnosticLogsSection
                  canRead={canReadDiagnostics}
                  canUpload={canUploadDiagnostics}
                  canEdit={canEditDiagnostics}
                />
                {canEditSettings && (
                  <SettingsCollapsibleCard
                    storageKey="novora_set_collapse_telemetry"
                    title="使用遥测"
                    icon={<RadioTower size={18} />}
                  >
                    <TelemetrySection canEditSettings={canEditSettings} />
                  </SettingsCollapsibleCard>
                )}
              </div>
            </section>
          )}

          {activeGroup === 'release' && (
            <section id="set-group-release" className="set-group" data-group="release">
              <h2 className="set-group__title">版本与更新</h2>
              <div className="set-group__body">
                <DeploymentSection adminUser={adminUser} />
              </div>
            </section>
          )}

          {activeGroup === 'maintenance' && canResetDatabase && (
            <section id="set-group-maintenance" className="set-group" data-group="maintenance">
              <h2 className="set-group__title">数据与维护</h2>
              <div className="set-group__body">
                <SettingsCollapsibleCard
                  storageKey="novora_set_collapse_maintenance"
                  title="数据维护"
                  icon={<DatabaseZap size={18} />}
                  badge="危险操作"
                  danger
                >
                  <DataMaintenanceSection canResetDatabase={canResetDatabase} />
                </SettingsCollapsibleCard>
              </div>
            </section>
          )}

          {/* ―― 关于：从正文移出，改由左栏底部入口进入 ―― */}
          {activeGroup === 'about' && <AboutSection />}
        </div>
      </div>
    </div>
  );
}
