import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  adminCan,
  getAdminUser,
  hasValidLocalToken,
  isLoginRequired,
  refreshAdminUser,
  type AdminUserContext,
} from "../services/examService";
import BatchPresetSettingsPanel from "../components/BatchPresetSettingsPanel";
import LoadingState from "../components/LoadingState";
import { APP_VERSION } from "../services/telemetry";
import "../styles/settings.css";
import AccessDenied from "../components/AccessDenied";
import AboutSection from "../components/settings/AboutSection";
import AnnouncementsSection from "../components/settings/AnnouncementsSection";
import TelemetrySection from "../components/settings/TelemetrySection";
import DeploymentSection from "../components/settings/DeploymentSection";
import SchoolInfoSection from "../components/settings/SchoolInfoSection";
import WeeklyCalendarSection from "../components/settings/WeeklyCalendarSection";
import SubjectTrackModeSection from "../components/settings/SubjectTrackModeSection";
import TimeSyncSection from "../components/settings/TimeSyncSection";
import AppearanceSection from "../components/settings/AppearanceSection";
import AlertsAdvancedSection from "../components/settings/AlertsAdvancedSection";
import DataMaintenanceSection from "../components/settings/DataMaintenanceSection";
import { ArrowLeft, ListChecks } from "lucide-react";

export default function SettingsPage() {
  const navigate = useNavigate();
  // 已有本地令牌时立即展示页面，跳过鉴权网络往返（数据库在新加坡、服务器在美国，
  // 跨洲往返会造成数秒白屏）；无令牌时才等待是否需要登录的判断。
  const [authed, setAuthed] = useState(() => hasValidLocalToken());
  const [adminUser, setAdminUser] = useState<AdminUserContext | null>(() =>
    getAdminUser(),
  );
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    if (hasValidLocalToken()) {
      refreshAdminUser().then((user) => {
        if (!user) {
          navigate("/login?next=/settings", { replace: true });
          return;
        }
        if (user.mustChangePassword) {
          navigate("/admin?tab=users&password=1", { replace: true });
          return;
        }
        if (!adminCan("settings.read", user)) {
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
      else navigate("/login?next=/settings", { replace: true });
    });
  }, [navigate]);
  const canEditSettings = adminUser
    ? adminCan("settings.edit", adminUser)
    : !hasValidLocalToken();
  const canEditMajorBatch = adminUser
    ? adminCan("settings.edit", adminUser) ||
      adminCan("settings.major_batch_edit", adminUser)
    : !hasValidLocalToken();
  const canEditWeekly = adminUser
    ? adminCan("weekly.edit", adminUser)
    : !hasValidLocalToken();
  const canReadAlerts = adminUser
    ? adminCan("alerts.read", adminUser)
    : !hasValidLocalToken();
  const canEditAlerts = adminUser
    ? adminCan("alerts.edit", adminUser)
    : !hasValidLocalToken();
  const canEditSchool = adminUser
    ? adminCan("initialization.run", adminUser)
    : !hasValidLocalToken();
  const canResetDatabase = adminUser
    ? adminUser.permissions.includes("*")
    : !hasValidLocalToken();



  if (!authed) return <LoadingState kind="auth" title="正在获取权限" message="正在确认系统设置权限…" />;
  if (denied)
    return (
      <AccessDenied moduleName="系统设置" onBack={() => navigate("/admin")} />
    );


  return (
    <div className="set-page">
      <header className="set-header">
        <div className="set-header__left">
          <button className="set-back" onClick={() => navigate("/admin")}>
            <ArrowLeft aria-hidden="true" />
            返回管理
          </button>
          <h1 className="set-title">系统设置</h1>
        </div>
        <span className="set-version">v{APP_VERSION}</span>
      </header>

      <div className="set-body">
        {!canEditSettings && (
          <div className="set-note set-note--warn">
            当前账号只能修改已授权的系统设置项，其余全局设置保持只读。如需修改登录密码，请前往“用户与权限”。
          </div>
        )}
        <SchoolInfoSection canEditSchool={canEditSchool} />
        <WeeklyCalendarSection canEditWeekly={canEditWeekly} adminUser={adminUser} />

        <SubjectTrackModeSection canEditSettings={canEditSettings} />

        {/* ―― 批量添加分考试预设 ―― */}
        <section className="set-card">
          <h2 className="set-card__title">
            <ListChecks size={18} />
            批量添加分考试预设
          </h2>
          <p className="set-note">
            管理批量添加分考试时可复用的常用科目组和常用时间组，与批量添加弹窗中的设置共享，可在此新建、排序或删除。
          </p>
          <BatchPresetSettingsPanel canEdit={canEditMajorBatch} />
        </section>

        <TimeSyncSection canEditSettings={canEditSettings} />

        <AppearanceSection canEditSettings={canEditSettings} />

        <AlertsAdvancedSection canReadAlerts={canReadAlerts} canEditAlerts={canEditAlerts} canEditSettings={canEditSettings} />

        {canResetDatabase && (
          <DataMaintenanceSection canResetDatabase={canResetDatabase} />
        )}

        <TelemetrySection canEditSettings={canEditSettings} />

        <DeploymentSection adminUser={adminUser} />

        <AnnouncementsSection />

        {/* ―― 关于（置于页面最底部） ―― */}
        <AboutSection />
      </div>
    </div>
  );
}
