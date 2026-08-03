import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Watermark from "../components/Watermark";
import AdminModalPortal from '../components/AdminModalPortal';
import {
  isOwnQuickTemporaryMajor as isOwnQuickTemporaryMajorCheck,
  isQuickTemporaryMajorFullyInScope,
} from "../utils/majorOwnership";
import type {
  ExamItem,
  MajorExam,
  AlertsSettings,
  AlertState,
  CustomReminder,
} from "../types";
import {
  getAppSettings,
  updateExamSettings,
  updateAlertsSettings,
  genMajorId,
  genReminderId,
  DEFAULT_ALERTS,
  normalizeAlerts,
} from "../utils/appSettings";
import {
  adminCan,
  adminCanClass,
  adminCanGrade,
  clearGradeAdminSetupPrompt,
  fetchExamsFromServer,
  getAdminRecoveryStatus,
  getAdminUser,
  getCloudSnapshot,
  hasValidLocalToken,
  isLoginRequired,
  logoutAdmin,
  refreshAdminUser,
  saveExamsToServer,
  shouldPromptGradeAdminSetup,
  takeGeneratedRecoveryKey,
  type AdminUserContext,
} from "../services/examService";
import { threeWayMergeExam } from "../utils/examMerge";
import {
  clearPendingExamSync,
  getPendingExamSync,
  queuePendingExamSync,
} from "../services/examOutbox";
import { normalizeExamItems } from "../utils/examSchedule";
import { getQuickMajorDisplayStatus } from "../utils/majorDisplayStatus";
import { recordSyncConflict } from "../services/offlineStore";
import { fetchAnnouncements } from "../services/announcements";
import type { Announcement } from "../services/announcements";
import { renderMarkdown } from "../utils/renderMarkdown";
import AnnouncementList from "../components/AnnouncementList";
import WeeklyPanel from "../components/WeeklyPanel";
import DeviceStatusPanel from "../components/DeviceStatusPanel";
import { getCachedDeviceBinding } from "../services/classBinding";
import AdminDeviceSetupPrompt from "../components/AdminDeviceSetupPrompt";
import ClassManagementPanel from "../components/ClassManagementPanel";
import InitializationWizard, {
  type InitializationCompletion,
  type InitializationPasswordChange,
} from "../components/InitializationWizard";
import UserManagementPanel from "../components/UserManagementPanel";
import HelpTip from "../components/HelpTip";
import ModuleIcon from "../components/ModuleIcon";
import SubjectIcon from "../components/SubjectIcon";
import OverviewPanel from "../components/OverviewPanel";
import DashboardPanel from "../components/DashboardPanel";
import AiImportGuide from "../components/AiImportGuide";
import AccessDenied from "../components/AccessDenied";
import SchedulePrintPreview from "../components/SchedulePrintPreview";
import BrandMark from "../components/BrandMark";
import LoadingState from "../components/LoadingState";
import QuickMajorPublishModal, {
  type QuickMajorPublishInput,
} from "../components/QuickMajorPublishModal";
import MajorBatchAddModal from "../components/MajorBatchAddModal";
import AdminWizardSteps, { AdminWorkflowClose } from "../components/AdminWizardSteps";
import InlineSelect from "../components/InlineSelect";
import TimeRangePickerModal from "../components/TimeRangePickerModal";
import { notify } from "../services/notify";
import { formatApiError } from "../services/apiError";
import { confirmDialog } from "../services/appDialog";
import { changeOwnPassword } from "../services/adminUsers";
import type { InitializationResult } from "../utils/initializationData";
import { useBackdropDismiss } from "../hooks/useBackdropDismiss";
import type {
  AdminTab,
  ScheduleMode,
  WeeklyPlan,
  WeeklyConflictPolicy,
} from "../types/exam";
import type { SchoolClass, SchoolGrade } from "../types/school";
import { genClassId, genGradeId, subjectAppliesToClass } from "../types/school";
import { COMMON_EXAM_SUBJECTS, isTrackSubject, normalizeSubjectName } from "../data/subjects";
import "../styles/admin.css";
import "../styles/admin-wizard-mobile-fix.css";
import "../styles/admin-track-additions.css";
import {
  ArrowLeft,
  Bell,
  CalendarDays,
  CircleHelp,
  Megaphone,
} from "lucide-react";
import { fmtAnnTime, makeId, fmtLocal, toISO, toLocalInput, duration, phase, syncMajorStateRef } from "../hooks/admin/adminPageUtils";
import type { SyncState } from "../hooks/admin/adminPageUtils";
import { useAdminAuthSession } from "../hooks/admin/useAdminAuthSession";
import { useAnnouncements } from "../hooks/admin/useAnnouncements";
import { useAdminModals, ADMIN_NAV } from "../hooks/admin/useAdminModals";
import { useInitializationWizard } from "../hooks/admin/useInitializationWizard";
import { useAlertsSettings } from "../hooks/admin/useAlertsSettings";
import { useWeeklyScheduleSync, type WeeklyState } from "../hooks/admin/useWeeklyScheduleSync";
import { useMajorScheduleActions, type MajorModal } from "../hooks/admin/useMajorScheduleActions";
import { useExamItemActions, type EditItem } from "../hooks/admin/useExamItemActions";
import { useSchoolStructureActions } from "../hooks/admin/useSchoolStructureActions";
import { useMajorImportExport } from "../hooks/admin/useMajorImportExport";
import { useAdminSyncEngine, OPEN_ADMIN } from "../hooks/admin/useAdminSyncEngine";

const STATUS = {
  waiting: { label: "待考", color: "#3498db", bg: "rgba(52,152,219,.15)" },
  ongoing: { label: "进行中", color: "#27ae60", bg: "rgba(39,174,96,.15)" },
  ended: { label: "已结束", color: "#6c757d", bg: "rgba(108,117,125,.15)" },
};
const CUSTOM_SUBJECT_VALUE = "__custom_subject__";
const MAJOR_DURATION_PRESETS = [45, 60, 75, 90, 120, 150];

const SYNC_META: Record<SyncState, { label: string; cls: string }> = {
  loading: { label: "连接中", cls: "is-loading" },
  saving: { label: "同步中", cls: "is-saving" },
  saved: { label: "已同步", cls: "is-saved" },
  offline: { label: "离线 · 待同步", cls: "is-offline" },
  error: { label: "同步失败", cls: "is-error" },
};

// 内置提醒状态的展示顺序与触发时机说明
const ALERT_STATE_ORDER: AlertState[] = [
  "15min",
  "5min",
  "start",
  "end15",
  "ended",
  "next",
];
const ALERT_STATE_META: Record<AlertState, { name: string; timing: string }> = {
  "15min": { name: "开考前 15 分钟", timing: "自动于开考前 15 分钟触发" },
  "5min": { name: "开考前 5 分钟", timing: "自动于开考前 5 分钟触发" },
  start: { name: "开考时刻", timing: "自动于开考时刻触发" },
  end15: { name: "结束前 15 分钟", timing: "自动于结束前 15 分钟触发" },
  ended: { name: "本场结束", timing: "自动于本场结束时触发" },
  next: { name: "下一科提示", timing: "本场结束且存在下一场时触发" },
};
const TONE_OPTIONS: Array<{ value: AlertState; label: string }> = [
  { value: "15min", label: "黄橙·准备" },
  { value: "5min", label: "红色·紧急" },
  { value: "start", label: "绿蓝·开始" },
  { value: "end15", label: "黄橙·注意" },
  { value: "ended", label: "冷调·结束" },
  { value: "next", label: "紫蓝·下一科" },
];
const ANCHOR_OPTIONS: Array<{
  value: CustomReminder["anchor"];
  label: string;
}> = [
  { value: "beforeStart", label: "开考前" },
  { value: "afterStart", label: "开考后" },
  { value: "beforeEnd", label: "结束前" },
];

export default function AdminPage() {
  const backdropProps = useBackdropDismiss();
  const navigate = useNavigate();
  const location = useLocation();
  const initial = getAppSettings().exam;

  // ---- 跨领域基础设施：indirection refs（打破 Hook 间的初始化顺序环依赖）----
  const stateRef = useRef<{ majors: MajorExam[]; activeMajorId: string }>({
    majors: initial.majors,
    activeMajorId: initial.activeMajorId,
  });
  const majorTimeFlowAnchorRef = useRef<HTMLButtonElement | null>(null);
  const pendingRef = useRef(false);
  const examPushChainRef = useRef<Promise<void>>(Promise.resolve());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const weeklySaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitRef = useRef<
    (ms: MajorExam[], activeId: string, immediate?: boolean, syncLabel?: string) => void
  >(() => {});
  const buildPayloadRef = useRef<
    (ms: MajorExam[], activeId: string) => Record<string, unknown>
  >(() => ({}));
  const setMajorsRef = useRef<(ms: MajorExam[]) => void>(() => {});
  const setActiveMajorIdRef = useRef<(id: string) => void>(() => {});
  const editingRef = useRef<{ name: string } | null>(null);
  const setEditingRef = useRef<(value: unknown) => void>(() => {});

  // ---- 云同步基础状态（多个领域 Hook 都需要写入，故不归属单个 Hook）----
  const [sync, setSync] = useState<SyncState>("loading");
  const [cloudReadConfirmed, setCloudReadConfirmed] = useState(false);
  const [online, setOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [recoveryConfigured, setRecoveryConfigured] = useState<boolean | null>(
    null,
  );
  const [adminNow, setAdminNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setAdminNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  // ---- 领域 Hook 编排（顺序即依赖顺序）----
  const auth = useAdminAuthSession();
  const { ready, setReady, adminUser, setAdminUser, currentDeviceBinding, gradeAdminSetupPromptOpen, setGradeAdminSetupPromptOpen } = auth;

  const announcements = useAnnouncements();
  const { announceOpen, setAnnounceOpen, anns, annLoading } = announcements;

  const defaultTab: AdminTab =
    initial.grades.length === 0 || initial.classes.length === 0
      ? "classes"
      : "overview";
  const modals = useAdminModals({
    adminUser,
    defaultTab,
    navigate,
    locationSearch: location.search,
  });
  const {
    adminTab,
    setAdminTab,
    deniedModule,
    setDeniedModule,
    moreOpen,
    setMoreOpen,
    moreMenuStyle,
    moreTriggerRef,
    placeMoreMenu,
  } = modals;

  const wizard = useInitializationWizard({
    initialValue: initial.initialization,
    setAdminTab,
    navigate,
  });
  const {
    initialization,
    setInitialization,
    initializationRef,
    wizardOpen,
    setWizardOpen,
    finalizeInitialization,
  } = wizard;

  const alertsSettings = useAlertsSettings({ stateRef, commitRef });
  const {
    alerts,
    setAlerts,
    alertsRef,
    alertsOpen,
    setAlertsOpen,
    alertsSection,
    setAlertsSection,
    setAlertsEnabled,
    setAlertsDuration,
    updateStateCfg,
    addCustomReminder,
    updateCustomReminder,
    removeCustomReminder,
    resetAlerts,
  } = alertsSettings;

  const weekly = useWeeklyScheduleSync({
    adminUser,
    initial: {
      scheduleMode: initial.scheduleMode,
      weeklyPlans: initial.weeklyPlans,
      activeWeeklyPlanId: initial.activeWeeklyPlanId,
      activeWeeklyPlanIdByClassId: initial.activeWeeklyPlanIdByClassId,
      grades: initial.grades,
      classes: initial.classes,
      weeklyConflictPolicy: initial.weeklyConflictPolicy,
    },
    navigate,
    stateRef,
    pendingRef,
    examPushChainRef,
    weeklySaveTimer,
    buildPayloadRef,
    setMajorsRef,
    setActiveMajorIdRef,
    setSync,
  });
  const {
    scheduleMode,
    setScheduleMode,
    weeklyPlans,
    setWeeklyPlans,
    activeWeeklyPlanId,
    setActiveWeeklyPlanId,
    activeWeeklyPlanIdByClassId,
    setActiveWeeklyPlanIdByClassId,
    grades,
    setGrades,
    classes,
    setClasses,
    weeklyConflictPolicy,
    setWeeklyConflictPolicy,
    weeklyStateRef,
    hasAllScope,
    visibleGrades,
    visibleClasses,
    visibleClassIds,
    visibleWeeklyPlans,
    pushWeeklyToServerExec,
    pushWeeklyToServer,
    commitWeekly,
    handleScheduleModeChange,
    handleSaveWeeklyPlans,
    handleConflictPolicyChange,
  } = weekly;

  const major = useMajorScheduleActions({
    adminUser,
    initialMajors: initial.majors,
    initialActiveMajorId: initial.activeMajorId,
    initialSelectedGradeId: initial.selectedGradeId || initial.grades[0]?.id || "",
    initialSelectedClassId: initial.selectedClassId,
    classes,
    visibleGrades,
    visibleClasses,
    visibleClassIds,
    hasAllScope,
    alertsRef,
    setAlerts,
    weeklyStateRef,
    initializationRef,
    navigate,
    pendingRef,
    examPushChainRef,
    saveTimer,
    stateRef,
    setSync,
    editingRef,
    setEditingRef,
  });
  const {
    majors,
    setMajors,
    activeMajorId,
    setActiveMajorId,
    editingMajorId,
    setEditingMajorId,
    editingMajorIdByGrade,
    setEditingMajorIdByGrade,
    selectedGradeId,
    setSelectedGradeId,
    selectedClassId,
    setSelectedClassId,
    majorModal,
    setMajorModal,
    majorModalStep,
    setMajorModalStep,
    majorError,
    setMajorError,
    deleteMajorOpen,
    setDeleteMajorOpen,
    quickMajorDeleteTarget,
    setQuickMajorDeleteTarget,
    majorPrintOpen,
    setMajorPrintOpen,
    quickMajorOpen,
    setQuickMajorOpen,
    majorBatchAddOpen,
    setMajorBatchAddOpen,
    visibleMajors,
    majorAppliesToGrade,
    scopedMajors,
    orderedScopedMajors,
    hasScopedMajor,
    activeMajor,
    items,
    subjectTrackModeEnabled,
    classesInMajorScope,
    autoTrackClassIdsForMajorItem,
    activeMajorTrackSubjects,
    activeMajorTrackScopedCount,
    activeMajorUnsetTrackClassCount,
    changeSelectedGrade,
    changeSelectedClass,
    buildPayload,
    pushToServerExec,
    pushToServer,
    commit,
    commitItems,
    commitBatchMajorItems,
    switchMajor,
    commitMajorModal,
    removeMajor,
    removeQuickMajor,
    publishQuickMajor,
    updateQuickMajor,
    extendQuickMajor,
    endQuickMajor,
    promoteQuickMajor,
  } = major;
  // 打通间接引用：其余 Hook 通过这些 ref 反向调用大型考试领域的最新实现
  commitRef.current = commit;
  buildPayloadRef.current = buildPayload;
  setMajorsRef.current = setMajors;
  setActiveMajorIdRef.current = setActiveMajorId;

  const examItem = useExamItemActions({
    items,
    activeMajor,
    commitItems,
    editingMajorId,
    autoTrackClassIdsForMajorItem,
  });
  const {
    editing,
    setEditing,
    customSubjectActive,
    setCustomSubjectActive,
    majorTimeFlowOpen,
    setMajorTimeFlowOpen,
    setMajorTimeFlowInitialEnd,
    editError,
    setEditError,
    deleteTarget,
    setDeleteTarget,
    selectedItemIds,
    setSelectedItemIds,
    deleteSelectedOpen,
    setDeleteSelectedOpen,
    lastDeletedExam,
    setLastDeletedExam,
    collapsedList,
    setCollapsedList,
    longDurationConfirmed,
    setLongDurationConfirmed,
    openMajorStartTimeFlow,
    cancelMajorTimeFlow,
    commitEdit,
    setExamEnabled,
    remove,
    removeItems,
    restoreExam,
  } = examItem;
  editingRef.current = editing;
  setEditingRef.current = setEditing as (value: unknown) => void;

  const school = useSchoolStructureActions({
    weeklyStateRef,
    commitWeekly,
    grades,
    classes,
    weeklyPlans,
    selectedGradeId,
    selectedClassId,
    changeSelectedGrade,
    changeSelectedClass,
    majors,
    setMajors,
    activeMajorId,
    stateRef,
  });
  const {
    addGrade,
    addClass,
    addClasses,
    removeClass,
    removeClasses,
    removeGrade,
    updateClassesTrack,
  } = school;

  const majorImportExport = useMajorImportExport({
    adminUser,
    hasScopedMajor,
    activeMajor,
    activeMajorId,
    items,
    majors,
    selectedGradeId,
    commit,
    setMoreOpen,
    setMajorError,
    setMajorModal,
  });
  const {
    importOpen,
    setImportOpen,
    majorImportStep,
    setMajorImportStep,
    openImportGuide,
    setOpenImportGuide,
    importText,
    setImportText,
    importError,
    setImportError,
    majorImportPreview,
    setMajorImportPreview,
    validateMajorImportJson,
    importJson,
    exportJson,
    openMajorImport,
  } = majorImportExport;

  const syncEngine = useAdminSyncEngine({
    navigate,
    location,
    adminUser,
    setAdminUser,
    setReady,
    setSync,
    setOnline,
    cloudReadConfirmed,
    setCloudReadConfirmed,
    setRecoveryConfigured,
    pendingRef,
    stateRef,
    weeklyStateRef,
    initializationCompletedAt: initialization.completedAt,
    gradesLength: grades.length,
    classesLength: classes.length,
    adminTab,
    setAdminTab,
    setAlertsOpen,
    setDeniedModule,
    setAnnounceOpen,
    setWizardOpen,
    setAlerts,
    setInitialization: (value) => setInitialization(value as never),
    pushToServer,
    pushWeeklyToServer,
    setMajors,
    setActiveMajorId,
    setEditingMajorId,
    setScheduleMode,
    setWeeklyPlans,
    setActiveWeeklyPlanId,
    setActiveWeeklyPlanIdByClassId,
    setGrades,
    setClasses,
    setSelectedGradeId,
    setSelectedClassId,
    setWeeklyConflictPolicy,
  });
  void syncEngine;

  // ---- 横跨多个领域、留在编排层的逻辑 ----
  const completeInitialization = async (
    result: InitializationResult,
    passwordChange: InitializationPasswordChange,
  ): Promise<InitializationCompletion> => {
    const nextWeekly = {
      scheduleMode: result.scheduleMode,
      weeklyPlans: result.weeklyPlans,
      activeWeeklyPlanId: result.activeWeeklyPlanId,
      activeWeeklyPlanIdByClassId: result.activeWeeklyPlanIdByClassId,
      grades: result.grades,
      classes: result.classes,
      weeklyConflictPolicy,
    };
    const active =
      result.majors.find((item) => item.id === result.activeMajorId) ??
      result.majors[0];
    const payload = {
      items: active?.items ?? [],
      title: active?.name ?? "",
      majors: result.majors,
      activeMajorId: result.activeMajorId,
      alerts: alertsRef.current,
      ...nextWeekly,
      initialization: result.initialization,
    };
    const alreadySaved =
      !!initializationRef.current.completedAt &&
      grades.length > 0 &&
      classes.length > 0;
    if (!alreadySaved) {
      setSync("saving");
      const saved = await saveExamsToServer({
        ...payload,
        action: "initialize",
        baseUpdatedAt: getCloudSnapshot()?.updatedAt ?? 0,
      });
      if (saved === "unauthorized") {
        navigate("/login?mode=initialize&next=/admin%3Finitialize%3D1", {
          replace: true,
        });
        return { ok: false, error: "登录状态已失效，请重新登录后继续初始化" };
      }
      if (typeof saved !== "number") {
        setSync("error");
        const message =
          saved && saved.kind === "error"
            ? formatApiError(saved.error)
            : "初始化数据未能写入云端，请刷新后重试。";
        notify("error", message, "初始化失败");
        return { ok: false, error: message };
      }
      setMajors(result.majors);
      setActiveMajorId(result.activeMajorId);
      setEditingMajorId(result.activeMajorId);
      setScheduleMode(result.scheduleMode);
      setWeeklyPlans(result.weeklyPlans);
      setActiveWeeklyPlanId(result.activeWeeklyPlanId);
      setActiveWeeklyPlanIdByClassId(result.activeWeeklyPlanIdByClassId);
      setGrades(result.grades);
      setClasses(result.classes);
      setSelectedGradeId("");
      setSelectedClassId("");
      setInitialization(result.initialization);
      syncMajorStateRef(stateRef, result.majors, result.activeMajorId);
      weeklyStateRef.current = nextWeekly;
      initializationRef.current = result.initialization;
      updateExamSettings({
        ...payload,
        selectedGradeId: "",
        selectedClassId: "",
        updatedAt: saved,
      });
      clearPendingExamSync();
      pendingRef.current = false;
      setSync("saved");
    }
    try {
      await changeOwnPassword(
        passwordChange.currentPassword,
        passwordChange.newPassword,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "超级管理员密码修改失败";
      notify("error", message, "学校信息已保存，请重新确认当前密码");
      return { ok: false, error: `学校信息已保存，但密码修改失败：${message}` };
    }
    return { ok: true, recoveryKey: takeGeneratedRecoveryKey() || undefined };
  };

  if (!ready || !adminUser)
    return <LoadingState kind="auth" title="正在获取权限" message="正在确认你的后台管理范围…" />;
  if (deniedModule)
    return (
      <AccessDenied
        moduleName={deniedModule}
        onBack={() => {
          setDeniedModule("");
          navigate("/admin", { replace: true });
        }}
      />
    );

  const syncMeta = SYNC_META[sync];
  const can = (permission: string) => adminCan(permission, adminUser);
  const isOwnQuickTemporaryMajor = (major: MajorExam) =>
    isOwnQuickTemporaryMajorCheck(
      major,
      adminUser?.id,
    );
  const canEndQuickTemporaryMajorInScope = (major: MajorExam) =>
    isQuickTemporaryMajorFullyInScope(
      major,
      (classId) => visibleClasses.some((item) => item.id === classId),
      (gradeId) => visibleGrades.some((item) => item.id === gradeId),
    );
  const canEditActiveMajor =
    can("major.edit") ||
    (can("major.quick_create") && isOwnQuickTemporaryMajor(activeMajor));
  const canDeleteActiveMajor =
    can("major.delete") ||
    (can("major.quick_create") && isOwnQuickTemporaryMajor(activeMajor));
  const canQuickPublish = can("major.create") || can("major.quick_create");
  const openMyAccount = () => {
    setDeniedModule("");
    navigate("/admin?tab=users&account=1");
    setAdminTab("users");
    setMoreOpen(false);
  };
  const selectAdminTab = (item: (typeof ADMIN_NAV)[number]) => {
    if (item.id === "users" && !can(item.permission)) {
      openMyAccount();
      return;
    }
    if (!can(item.permission)) {
      setDeniedModule(item.label);
      return;
    }
    setDeniedModule("");
    setAdminTab(item.id);
  };
  const editDurationMs =
    editing?.startTime && editing?.endTime
      ? new Date(editing.endTime).getTime() -
        new Date(editing.startTime).getTime()
      : 0;
  const isLongEdit =
    Number.isFinite(editDurationMs) && editDurationMs > 6 * 60 * 60 * 1000;
  const activeMajorScopeLabel = activeMajor.targetClassIds?.length
    ? `指定 ${activeMajor.targetClassIds.length} 个班级`
    : activeMajor.targetGradeIds?.length
      ? activeMajor.targetGradeIds
          .map((id) => grades.find((grade) => grade.id === id)?.name || id)
          .join("、")
      : "全校";
  // 预览与导出 PDF 时，若当前正查看某个具体班级，按该班级的选科结果实时过滤
  // 科目，而不是展示整个大型考试范围内的全部科目（修复选科结果未下发到
  // 考试安排预览的问题）。
  const majorPrintClass = selectedClassId
    ? visibleClasses.find((item) => item.id === selectedClassId)
    : undefined;
  const quickScopedMajors = orderedScopedMajors.filter(
    (major) =>
      major.temporary &&
      !major.endedAt &&
      major.items.some(
        (item) =>
          item.enabled && new Date(item.endTime).getTime() >= adminNow,
      ),
  );

  return (
    <div className="admin-page">
      <AdminDeviceSetupPrompt user={adminUser} grades={visibleGrades} classes={visibleClasses} canBind={can("device.bind")} />
      <Watermark />
      <header className="admin-header">
        <div className="admin-header__left">
          <button
            className="admin-back-btn admin-back-btn--icon"
            onClick={() => navigate("/")}
            aria-label="返回首页"
            title="返回首页"
          >
            <ArrowLeft />
          </button>
          <BrandMark compact className="admin-header__brand" />
          <div className="admin-header__identity">
            <h1 className="admin-header__title">考试管理</h1>
            <span>{ADMIN_NAV.find((item) => item.id === adminTab)?.label}</span>
          </div>
          {hasScopedMajor && adminTab === "major" && (
            <span
              className="admin-header__major"
              title={`适用范围：${activeMajorScopeLabel}`}
            >
              <span className="admin-header__major-dot" />
              {activeMajorScopeLabel} · {activeMajor.name}
              <span className="admin-header__major-count">
                {items.length} 科
              </span>
            </span>
          )}
        </div>
        <div className="admin-header__right">
          {currentDeviceBinding &&
            !currentDeviceBinding.revoked &&
            !currentDeviceBinding.isManagement &&
            currentDeviceBinding.classId && (
              <button
                type="button"
                className="admin-device-role-chip"
                title="当前为班级设备；如需更改角色，请前往设备管理"
                onClick={() =>
                  selectAdminTab(
                    ADMIN_NAV.find((item) => item.id === "devices")!,
                  )
                }
              >
                <strong>当前为班级设备</strong>
                <small>更改角色请前往设备管理</small>
              </button>
            )}
          <span
            className="admin-user-chip"
            title={`登录账号：${adminUser.username}`}
          >
            <strong>{adminUser.displayName}</strong>
            <small>{adminUser.roleName}</small>
          </span>
          <span
            className={`admin-cloud ${syncMeta.cls}`}
            title={online ? "云服务在线" : "当前离线"}
          >
            <span className="admin-cloud__dot" />
            {syncMeta.label}
          </span>
          <div className="admin-header__quick-actions">
            {canQuickPublish && (
              <button
                className="admin-btn admin-btn--primary"
                onClick={() => setQuickMajorOpen(true)}
              >
                {adminUser.roleId === "class_admin"
                ? "添加班级单科考试"
                : "统一添加单科考试"}
              </button>
            )}
            {can("alerts.read") && (
              <button
                className="admin-btn admin-btn--primary"
                onClick={() => setAlertsOpen(true)}
              >
                提醒{alerts.enabled ? "" : "（停用）"}
              </button>
            )}
            {can("settings.read") && (
              <button
                className="admin-btn"
                onClick={() => navigate("/settings")}
              >
                系统设置
              </button>
            )}
          </div>
          <div className="admin-more">
            <button
              ref={moreTriggerRef}
              className="admin-btn admin-more__trigger"
              onClick={() => {
                if (moreOpen) {
                  setMoreOpen(false);
                  return;
                }
                placeMoreMenu();
                setMoreOpen(true);
              }}
              aria-expanded={moreOpen}
              aria-haspopup="menu"
            >
              更多
            </button>
            {moreOpen && (
              <div
                className="admin-more__menu"
                style={moreMenuStyle}
                role="menu"
              >
                <button
                  onClick={() => {
                    navigate("/admin?tab=users&account=1");
                    setAdminTab("users");
                    setMoreOpen(false);
                  }}
                >
                  我的账户
                </button>
                {currentDeviceBinding &&
                  !currentDeviceBinding.revoked &&
                  !currentDeviceBinding.isManagement &&
                  currentDeviceBinding.classId && (
                    <button
                      className="admin-more__mobile-only"
                      onClick={() => {
                        selectAdminTab(
                          ADMIN_NAV.find((item) => item.id === "devices")!,
                        );
                        setMoreOpen(false);
                      }}
                    >
                      当前为班级设备 · 前往设备管理
                    </button>
                  )}
                {can("major.create") && (
                  <button
                    className="admin-more__mobile-only"
                    onClick={() => {
                      setQuickMajorOpen(true);
                      setMoreOpen(false);
                    }}
                  >
                  统一添加单科考试
                  </button>
                )}
                {adminUser.roleId === "grade_admin" && can("user.create") && (
                  <button
                    onClick={() => {
                      navigate("/admin?tab=users&batch=1");
                      setAdminTab("users");
                      setMoreOpen(false);
                    }}
                  >
                    批量添加班级管理员
                  </button>
                )}
                <button
                  onClick={() => {
                    setAnnounceOpen(true);
                    setMoreOpen(false);
                  }}
                >
                  查看公告
                </button>
                {can("alerts.read") && (
                  <button
                    className="admin-more__mobile-only"
                    onClick={() => {
                      setAlertsOpen(true);
                      setMoreOpen(false);
                    }}
                  >
                    提醒管理{alerts.enabled ? "" : "（已停用）"}
                  </button>
                )}
                {can("settings.read") && (
                  <button
                    className="admin-more__mobile-only"
                    onClick={() => {
                      navigate("/settings");
                      setMoreOpen(false);
                    }}
                  >
                    系统设置
                  </button>
                )}
                {can("initialization.run") &&
                  (!initialization.completedAt ||
                    grades.length === 0 ||
                    classes.length === 0) && (
                    <button
                      onClick={() => {
                        setWizardOpen(true);
                        setMoreOpen(false);
                      }}
                    >
                      首次初始化
                    </button>
                  )}
                {adminTab === "major" && can("major.import") && (
                  <button onClick={() => openMajorImport()}>导入大型考试 JSON</button>
                )}
                {adminTab === "major" && can("major.export") && (
                  <button
                    onClick={() => {
                      exportJson();
                      setMoreOpen(false);
                    }}
                  >
                    导出大型考试 JSON
                  </button>
                )}
                <button
                  className="is-danger"
                  onClick={() => {
                    logoutAdmin();
                    navigate("/login?next=/admin", { replace: true });
                  }}
                >
                  退出登录
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <div
        className={`admin-tabbar${adminTab === "major" || adminTab === "weekly" ? " has-context" : ""}`}
      >
        <div className="admin-tabbar__tabs">
          {ADMIN_NAV.filter(
            (item) => item.id === "users" || can(item.permission),
          ).map((item) => (
            <button
              key={item.id}
              className={`admin-tab${adminTab === item.id ? " is-active" : ""}`}
              onClick={() => selectAdminTab(item)}
              aria-current={adminTab === item.id ? "page" : undefined}
            >
              <span>
                <ModuleIcon module={item.id} size={16} />
              </span>
              {item.label}
              {item.id === "weekly" && visibleWeeklyPlans.length
                ? `（${visibleWeeklyPlans.length}）`
                : ""}
            </button>
          ))}
        </div>
        {adminTab !== "overview" && adminTab !== "dashboard" &&
          adminTab !== "devices" &&
          adminTab !== "classes" &&
          adminTab !== "users" && (
            <>
              <label className="admin-tabbar__mode">
                <span className="admin-tabbar__mode-label with-help-tip">
                  <span>运行模式</span>
                  <HelpTip title="运行模式">
                    仅大型考试或仅周测会隐藏另一类安排；自动模式会同时调度，并按冲突规则让周测避开大型考试。
                  </HelpTip>
                </span>
                <InlineSelect
                  className="admin-input"
                  value={scheduleMode}
                  onChange={(value) =>
                    handleScheduleModeChange(value as ScheduleMode)
                  }
                  disabled={!can("schedule.mode_edit")}
                  options={[
                    { value: "major-only", label: "仅大型考试" },
                    { value: "weekly-only", label: "仅周测" },
                    {
                      value: "automatic",
                      label: "自动（大型考试优先，自动避让周测）",
                    },
                  ]}
                />
              </label>
              <label className="admin-tabbar__mode">
                年级
                <InlineSelect
                  className="admin-input"
                  value={selectedGradeId}
                  placeholder="请选择年级"
                  onChange={changeSelectedGrade}
                  options={[
                    { value: "", label: "请选择年级" },
                    ...visibleGrades.map((item) => ({
                      value: item.id,
                      label: item.name,
                    })),
                  ]}
                />
              </label>
              {adminTab === "weekly" && (
                <label className="admin-tabbar__mode">
                  班级
                  <InlineSelect
                    className="admin-input"
                    value={selectedClassId}
                    placeholder="请选择班级"
                    onChange={changeSelectedClass}
                    disabled={!selectedGradeId}
                    options={[
                      { value: "", label: "请选择班级" },
                      ...visibleClasses
                        .filter((item) => item.gradeId === selectedGradeId)
                        .map((item) => ({ value: item.id, label: item.name })),
                    ]}
                  />
                </label>
              )}
            </>
          )}
      </div>
      <div
        key={adminTab}
        className={`admin-body admin-tab-transition${(["overview", "dashboard", "classes", "devices", "users"] as AdminTab[]).includes(adminTab) ? " admin-body--wide" : ""}`}
      >
        {adminTab === "overview" ? (
          <OverviewPanel
            user={adminUser}
            grades={visibleGrades}
            classes={visibleClasses}
            majors={visibleMajors}
            weeklyPlans={visibleWeeklyPlans}
            syncLabel={syncMeta.label}
            online={online}
            onQuickPublish={
              canQuickPublish ? () => setQuickMajorOpen(true) : undefined
            }
          />
        ) : adminTab === "dashboard" ? (
          <DashboardPanel />
        ) : adminTab === "weekly" ? (
          <fieldset
            className="admin-permission-fieldset"
            disabled={!can("weekly.edit")}
          >
            <WeeklyPanel
              weeklyPlans={visibleWeeklyPlans}
              activeWeeklyPlanId={activeWeeklyPlanId}
              activeWeeklyPlanIdByClassId={activeWeeklyPlanIdByClassId}
              selectedGradeId={selectedGradeId}
              selectedClassId={selectedClassId}
              selectedClassName={
                visibleClasses.find((item) => item.id === selectedClassId)
                  ?.name ?? "当前班级"
              }
              classOptions={visibleClasses.map((item) => ({
                id: item.id,
                gradeId: item.gradeId,
                label: `${visibleGrades.find((grade) => grade.id === item.gradeId)?.name ?? "未知年级"} · ${item.name}`,
              }))}
              scheduleMode={scheduleMode}
              weeklyConflictPolicy={weeklyConflictPolicy}
              majorItems={orderedScopedMajors.flatMap((major) => major.items)}
              majorName={orderedScopedMajors
                .map((major) => major.name)
                .join("、")}
              onSavePlans={handleSaveWeeklyPlans}
              onConflictPolicyChange={handleConflictPolicyChange}
              onSelectScope={(gradeId, classId) => {
                setSelectedGradeId(gradeId);
                setSelectedClassId(classId);
              }}
              allowBatchApply={
                can("weekly.copy") && visibleClasses.length > 1
              }
            />
          </fieldset>
        ) : adminTab === "classes" ? (
          <ClassManagementPanel
            grades={visibleGrades}
            classes={visibleClasses}
            weeklyPlans={visibleWeeklyPlans}
            majors={visibleMajors}
            onAddGrade={addGrade}
            onRemoveGrade={removeGrade}
            onAddClass={addClass}
            onAddClasses={addClasses}
            onRemoveClass={removeClass}
            onRemoveClasses={removeClasses}
            onUpdateClassesTrack={updateClassesTrack}
            canManageGrades={can("school.grade_manage")}
            canManageClasses={can("school.class_manage")}
          />
        ) : adminTab === "devices" ? (
          <DeviceStatusPanel canRevoke={can("device.revoke")} canBind={can("device.bind")} canEditDesign={hasAllScope && can("settings.edit")} />
        ) : adminTab === "users" ? (
          <UserManagementPanel
            grades={visibleGrades}
            classes={visibleClasses}
            currentUser={adminUser}
            forcePasswordChange={
              adminUser.mustChangePassword ||
              new URLSearchParams(location.search).get("password") === "1"
            }
            openBatchCreate={
              new URLSearchParams(location.search).get("batch") === "1"
            }
          />
        ) : (
          <>
            <aside className="admin-sidebar">
              {/* 大型考试：添加 / 切换 / 重命名 / 删除 */}
              <div className="admin-major-card">
                <div className="admin-major-card__head">
                  <label className="admin-label" style={{ opacity: 0.9 }}>
                    {grades.find((grade) => grade.id === selectedGradeId)
                      ?.name || "当前年级"}{" "}
                    · 大型考试
                  </label>
                  <span className="admin-major-card__count">
                    共 {orderedScopedMajors.length} 场
                  </span>
                </div>
                <div className="admin-major-card__active">
                  <span
                    className="admin-major-card__active-name"
                    title={activeMajor?.name}
                  >
                    {activeMajor?.name || "未命名考试"}
                  </span>
                  <span className="admin-major-card__active-meta">
                    {items.length} 个分考试 ·{" "}
                    {items.filter((i) => i.enabled).length} 个启用
                  </span>
                </div>
                {orderedScopedMajors.length > 0 && (
                  <label className="admin-major-card__switch">
                    <span className="admin-major-card__switch-k">切换考试</span>
                    <InlineSelect
                      className="admin-input admin-major-select"
                      value={activeMajor.id}
                      onChange={switchMajor}
                      disabled={orderedScopedMajors.length === 1}
                      options={orderedScopedMajors.map((m) => ({
                        value: m.id,
                        label: `${m.name}（${m.items.length} 科）${!m.targetGradeIds?.length ? " · 全校统一" : ""}`,
                      }))}
                    />
                  </label>
                )}
                <div className="admin-major-card__btns">
                  {canQuickPublish && (
                    <button
                      className="admin-btn admin-btn--primary"
                      onClick={() => setQuickMajorOpen(true)}
                    >
                      快速发布
                    </button>
                  )}
                  {can("major.create") && (
                    <button
                      className="admin-btn admin-btn--primary"
                      onClick={() => {
                        setMajorModal({
                          mode: "add",
                          name: "",
                          targetGradeIds: selectedGradeId
                            ? [selectedGradeId]
                            : [],
                        });
                        setMajorError("");
                      }}
                    >
                      + 新建
                    </button>
                  )}
                  {hasScopedMajor && can("major.edit") && (
                    <button
                      className="admin-btn"
                      onClick={() => {
                        setMajorModal({
                          mode: "rename",
                          name: activeMajor.name,
                          targetGradeIds: activeMajor.targetGradeIds || [],
                        });
                        setMajorError("");
                      }}
                    >
                      设置
                    </button>
                  )}
                  {hasScopedMajor && canDeleteActiveMajor && (
                    <button
                      className="admin-btn admin-btn--danger"
                      onClick={() => setDeleteMajorOpen(true)}
                      disabled={majors.length <= 1}
                    >
                      删除
                    </button>
                  )}
                </div>
                <p className="admin-major-card__hint">
                  切换年级只改变后台管理内容；大屏始终按设备绑定班级所属年级自动匹配适用考试。
                </p>
                {activeMajorTrackSubjects.length > 0 && (
                  <div className="admin-warning-banner admin-warning-banner--structured">
                    {subjectTrackModeEnabled ? (
                      <>
                        <span><strong>规则</strong>语数外全班显示，选考科目按班级选科显示。</span>
                        <span><strong>进度</strong>已设置 {activeMajorTrackScopedCount}/{activeMajorTrackSubjects.length} 个选考科目，旧数据自动兜底过滤。</span>
                        {activeMajorUnsetTrackClassCount > 0 && (
                          <span><strong>未分科</strong>{activeMajorUnsetTrackClassCount} 个班级读取全部科目。</span>
                        )}
                      </>
                    ) : (
                      <span><strong>分科关闭</strong>所有分考试按考试范围直接下放，不按班级选科过滤。</span>
                    )}
                  </div>
                )}
              </div>

              {quickScopedMajors.length > 0 && (
                <section className="quick-major-running">
                  <div className="quick-major-running__head">
                    <strong>临时统一考试</strong>
                    <span>{quickScopedMajors.length} 场</span>
                  </div>
                  {quickScopedMajors.map((major) => {
                    const item = major.items.find((value) => value.enabled);
                    const running =
                      item &&
                      new Date(item.startTime).getTime() <= adminNow &&
                      new Date(item.endTime).getTime() > adminNow;
                    const displayStatus = getQuickMajorDisplayStatus(
                      major,
                      orderedScopedMajors,
                      adminNow,
                      visibleClasses,
                    );
                    const canManageQuickMajor =
                      can("major.edit") ||
                      (can("major.quick_create") && isOwnQuickTemporaryMajor(major));
                    const canEndQuickMajor =
                      can("major.edit") ||
                      (can("major.quick_create") && canEndQuickTemporaryMajorInScope(major));
                    const canDeleteQuickMajor =
                      can("major.delete") ||
                      (can("major.quick_create") && isOwnQuickTemporaryMajor(major));
                    return (
                      <article key={major.id}>
                        <div>
                          <strong>{major.name}</strong>
                          <small>
                            {item
                              ? `${item.name} · ${fmtLocal(item.startTime)} - ${fmtLocal(item.endTime)}`
                              : "已结束"}
                            {major.priorityOverSchedule ? " · 优先覆盖" : ""}
                          </small>
                        </div>
                        <span className={running ? "is-running" : ""}>
                          {running ? "进行中" : "待开始"}
                        </span>
                        {displayStatus && (
                          <div
                            className={`quick-major-running__display is-${displayStatus.tone}`}
                          >
                            <strong>{displayStatus.label}</strong>
                            <span>{displayStatus.detail}</span>
                          </div>
                        )}
                        {(canManageQuickMajor || canEndQuickMajor || canDeleteQuickMajor) && (
                          <div className="quick-major-running__actions">
                            {canManageQuickMajor && <>
                              <button
                                className="admin-item-btn"
                                onClick={() => extendQuickMajor(major)}
                              >
                                延长 5 分钟
                              </button>
                              <button
                                className="admin-item-btn admin-item-btn--delete"
                                onClick={() => endQuickMajor(major)}
                              >
                                提前结束
                              </button>
                            </>}
                            {!canManageQuickMajor && canEndQuickMajor && (
                              <button
                                className="admin-item-btn admin-item-btn--delete"
                                onClick={() => endQuickMajor(major)}
                              >
                                提前结束
                              </button>
                            )}
                            {can("major.edit") && <button
                              className="admin-item-btn"
                              onClick={() => promoteQuickMajor(major)}
                            >
                              转正式
                            </button>}
                            {canDeleteQuickMajor && <button
                              className="admin-item-btn admin-item-btn--delete"
                              onClick={() => setQuickMajorDeleteTarget(major)}
                            >
                              删除
                            </button>}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </section>
              )}

              {hasScopedMajor &&
                canEditActiveMajor &&
                (editing ? (
                  <div className="admin-form-card">
                    <h2 className="admin-form-card__title">
                      {editing.id ? "编辑分考试" : "添加分考试"}
                    </h2>
                    {editError && (
                      <div className="admin-error">{editError}</div>
                    )}
                    <div className="admin-form">
                      <label className="admin-label">
                        科目名称
                        <InlineSelect
                          className="admin-major-subject-select"
                          ariaLabel="选择考试科目"
                          value={customSubjectActive || (editing.name && !COMMON_EXAM_SUBJECTS.includes(editing.name)) ? CUSTOM_SUBJECT_VALUE : editing.name}
                          placeholder="选择常用科目"
                          options={[
                            { value: "", label: "选择常用科目" },
                            ...COMMON_EXAM_SUBJECTS.map((subject) => ({ value: subject, label: <><SubjectIcon subject={subject} size={16} />{subject}</> })),
                            { value: CUSTOM_SUBJECT_VALUE, label: <><SubjectIcon subject="其他" size={16} />其他 / 自定义</> },
                          ]}
                          onChange={(value) => {
                            if (value === CUSTOM_SUBJECT_VALUE) {
                              setCustomSubjectActive(true);
                              return;
                            }
                            setCustomSubjectActive(false);
                            setEditing((p) => p && { ...p, name: value });
                          }}
                        />
                        {(customSubjectActive || (editing.name && !COMMON_EXAM_SUBJECTS.includes(editing.name))) && <input className="admin-input" value={editing.name} onChange={(e) => setEditing((p) => p && { ...p, name: e.target.value })} placeholder="填写自定义科目名称" maxLength={40} autoFocus />}
                      </label>
                      <div className="admin-major-endtime admin-major-time-setting">
                        <span>时间设置</span>
                        <button
                          type="button"
                          className="admin-major-endtime__trigger"
                          ref={majorTimeFlowAnchorRef}
                          onClick={openMajorStartTimeFlow}
                        >
                          <strong>{editing.startTime && editing.endTime ? `${fmtLocal(editing.startTime)} - ${fmtLocal(editing.endTime)}` : "设置考试时间"}</strong>
                          <small>一次设置开始日期、结束日期、时分和常用时长</small>
                        </button>
                      </div>
                      {isLongEdit && (
                        <label className="admin-long-duration">
                          <input
                            type="checkbox"
                            checked={longDurationConfirmed}
                            onChange={(e) =>
                              setLongDurationConfirmed(e.target.checked)
                            }
                          />
                          我确认这是超过 6 小时的跨天或特殊考试安排
                        </label>
                      )}
                      <label className="admin-toggle-label">
                        <input
                          type="checkbox"
                          checked={editing.enabled}
                          onChange={(e) =>
                            setEditing(
                              (p) => p && { ...p, enabled: e.target.checked },
                            )
                          }
                        />
                        启用此科目
                      </label>
                      <div className="admin-form-actions">
                        <button
                          className="admin-btn admin-btn--primary"
                          onClick={() => void commitEdit()}
                        >
                          确认并保存
                        </button>
                        <button
                          className="admin-btn admin-btn--ghost"
                          onClick={() => {
                            setMajorTimeFlowOpen(false);
                            setEditing(null);
                            setCustomSubjectActive(false);
                            setEditError("");
                          }}
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="admin-major-add-actions">
                    <button
                    className="admin-btn admin-btn--primary"
                    onClick={() => {
                      setLongDurationConfirmed(false);
                      setCustomSubjectActive(false);
                      setMajorTimeFlowOpen(false);
                      setMajorTimeFlowInitialEnd("");
                      setEditing({
                        name: "",
                        startTime: "",
                        endTime: "",
                        enabled: true,
                      });
                    }}
                  >
                    + 添加分考试
                    </button>
                    <button
                      className="admin-btn"
                      onClick={() => setMajorBatchAddOpen(true)}
                    >
                      批量添加分考试
                    </button>
                  </div>
                ))}
              <div className="admin-tips">
                <p className="admin-tips__title">
                  <CircleHelp size={16} />
                  使用说明
                </p>
                <ul>
                  <li>每次修改会自动保存并同步到云（Neon）</li>
                  <li>离线时仍可编辑，数据先存本地，联网后自动回推</li>
                  <li>不同大型考试各自拥有独立的分考试列表</li>
                  <li>大屏每 30 秒自动拉取最新数据</li>
                </ul>
              </div>
            </aside>
            <main className="admin-main">
              <div className="admin-list-header">
                <h2 className="admin-list-title">
                  {activeMajor.name} · 考试安排
                </h2>
                <span className="admin-list-count">{items.length} 项</span>
                {selectedItemIds.size > 0 && canDeleteActiveMajor && (
                  <button
                    className="admin-btn admin-btn--danger"
                    onClick={() => setDeleteSelectedOpen(true)}
                  >
                    批量删除（{selectedItemIds.size}）
                  </button>
                )}
                {items.length > 0 && (
                  <>
                    <button
                      className="admin-btn"
                      onClick={() => setMajorPrintOpen(true)}
                    >
                      预览与导出 PDF
                    </button>
                    <button
                      className="admin-btn admin-btn--ghost admin-list-collapse"
                      onClick={() => setCollapsedList((v) => !v)}
                      aria-expanded={!collapsedList}
                    >
                      {collapsedList ? "展开列表" : "折叠列表"}
                    </button>
                  </>
                )}
              </div>
              {lastDeletedExam && (
                <div className="admin-undo">
                  <span>已删除「{lastDeletedExam.item.name}」</span>
                  <button
                    className="admin-btn admin-btn--ghost"
                    onClick={restoreExam}
                  >
                    撤销删除
                  </button>
                </div>
              )}
              {items.length === 0 ? (
                <div className="admin-empty">
                  <div className="admin-empty__icon">
                    <CalendarDays />
                  </div>
                  <p>当前大型考试暂无分考试，点击左侧“添加分考试”开始</p>
                </div>
              ) : collapsedList ? (
                <div className="admin-collapsed-hint">
                  列表已折叠（共 {items.length} 项），点击“展开列表”查看
                </div>
              ) : (
                <ul
                  className="admin-list"
                  style={{ listStyle: "none", padding: 0, margin: 0 }}
                >
                  {items.map((item, index) => {
                    const status = STATUS[phase(item)];
                    return (
                      <li
                        className={`admin-item${canDeleteActiveMajor ? " admin-item--selectable" : ""}${!item.enabled ? " admin-item--disabled" : ""}`}
                        key={item.id}
                      >
                        {canDeleteActiveMajor && (
                          <label
                            className="admin-item__select"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={selectedItemIds.has(item.id)}
                              onChange={(e) => {
                                setSelectedItemIds((prev) => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.add(item.id);
                                  else next.delete(item.id);
                                  return next;
                                });
                              }}
                              aria-label={`选择「${item.name}」`}
                            />
                          </label>
                        )}
                        <div className="admin-item__order">
                          <span className="admin-item__order-num">
                            #{index + 1}
                          </span>
                        </div>
                        <div className="admin-item__info">
                          <div className="admin-item__name-row">
                            <span className="admin-item__name">
                              <SubjectIcon subject={item.name} size={16} />
                              {item.name}
                            </span>
                            <span
                              className="admin-item__status"
                              style={{
                                color: status.color,
                                background: status.bg,
                              }}
                            >
                              {status.label}
                            </span>
                            {!item.enabled && (
                              <span
                                className="admin-item__status"
                                style={{
                                  color: "#6c757d",
                                  background: "rgba(108,117,125,.1)",
                                }}
                              >
                                已禁用
                              </span>
                            )}
                          </div>
                          <div className="admin-item__times">
                            <span>{fmtLocal(item.startTime)}</span>
                            <span className="admin-item__times-sep">–</span>
                            <span>{fmtLocal(item.endTime)}</span>
                            <span className="admin-item__duration">
                              {duration(item.startTime, item.endTime)}
                            </span>
                          </div>
                        </div>
                        {canEditActiveMajor && (
                          <div className="admin-item__actions">
                            <button
                              type="button"
                              className={`admin-item-btn admin-item-btn--toggle ${item.enabled ? "admin-item-btn--disable" : "admin-item-btn--enable"}`}
                              title={
                                item.enabled
                                  ? "停用后不会出现在首页、大屏或提醒中"
                                  : "启用后会参与首页、大屏和提醒计算"
                              }
                              aria-label={`${item.enabled ? "停用" : "启用"}${item.name}`}
                              onClick={() =>
                                setExamEnabled(item.id, !item.enabled)
                              }
                            >
                              {item.enabled ? "停用" : "启用"}
                            </button>
                            <button
                              className="admin-item-btn"
                              onClick={() => {
                                setLongDurationConfirmed(false);
                                setCustomSubjectActive(false);
                                setEditing({ ...item });
                              }}
                            >
                              编辑
                            </button>
                            {canDeleteActiveMajor && (
                              <button
                                className="admin-item-btn admin-item-btn--delete"
                                onClick={() => setDeleteTarget(item)}
                              >
                                删除
                              </button>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </main>
          </>
        )}
      </div>
      <nav className="admin-mobile-nav" aria-label="管理功能">
        {ADMIN_NAV.filter(
          (item) => item.id === "users" || can(item.permission),
        ).map((item) => (
          <button
            key={item.id}
            className={adminTab === item.id ? "is-active" : ""}
            onClick={() =>
              item.id === "users" ? openMyAccount() : selectAdminTab(item)
            }
            aria-current={adminTab === item.id ? "page" : undefined}
          >
            <span aria-hidden="true">
              <ModuleIcon module={item.id} size={18} />
            </span>
            <small>{item.id === "users" ? "我的账户" : item.mobileLabel}</small>
          </button>
        ))}
      </nav>
      {gradeAdminSetupPromptOpen && (
        <AdminModalPortal className="admin-modal-overlay">
          <div
            className="admin-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="admin-modal__title">快速添加班级管理员</h2>
            <p className="admin-modal__body">
              这是该年级管理员账号首次登录。可为授权年级下的各班创建班级管理员账号，让每位管理员只维护自己的班级。
            </p>
            <p className="admin-major-card__hint">
              可管理范围：
              {visibleGrades.map((grade) => grade.name).join("、") ||
                "当前授权年级"}
              。创建账号时选择“班级管理员”角色，并勾选对应班级。
            </p>
            <div className="admin-modal__actions">
              <button
                className="admin-btn admin-btn--primary"
                onClick={() => {
                  clearGradeAdminSetupPrompt();
                  setGradeAdminSetupPromptOpen(false);
                  setAdminTab("users");
                }}
              >
                前往添加账号
              </button>
              <button
                className="admin-btn"
                onClick={() => {
                  clearGradeAdminSetupPrompt();
                  setGradeAdminSetupPromptOpen(false);
                }}
              >
                稍后处理
              </button>
            </div>
          </div>
        </AdminModalPortal>
      )}
      {majorModal && (
        <AdminModalPortal
          className="admin-modal-overlay"
          {...backdropProps(() => setMajorModal(null))}
        >
          <div className="admin-modal admin-modal--wide admin-modal--workflow" onClick={(e) => e.stopPropagation()}>
            <h2 className="admin-modal__title admin-workflow-head">
              {majorModal.next === "import"
                ? "先填写考试标题"
                : majorModal.mode === "add"
                  ? "新建大型考试"
                  : "大型考试设置"}
            </h2>
            <AdminWorkflowClose onClick={() => { setMajorModal(null); setMajorError(""); }} />
            {majorError && <div className="admin-error">{majorError}</div>}
            <div className="admin-workflow-layout">
              <AdminWizardSteps
                active={majorModalStep}
                steps={[{ label: "考试名称", hint: "填写清晰的考试标题" }, { label: "适用范围", hint: "确认下发年级" }]}
                summary={<><span>大型考试</span><strong>{majorModal.name || "尚未命名"}</strong><span>{majorModal.targetGradeIds.length ? visibleGrades.find((grade) => grade.id === majorModal.targetGradeIds[0])?.name || "指定年级" : "全校统一"}</span></>}
              />
              <div className="admin-workflow-content" key={majorModalStep}>
                {majorModalStep === 0 && <div className="admin-workflow-pane">
                  {majorModal.next === "import" && <p className="admin-modal__body">当前年级还没有大型考试。先填写标题，创建后将生成对应的 AI 识图提示词。</p>}
                  <label className="admin-label">
                    考试名称
                    <input className="admin-input" autoFocus value={majorModal.name} onChange={(e) => setMajorModal((p) => p && { ...p, name: e.target.value })} placeholder="如：2026年高考 / 高三一模" />
                  </label>
                </div>}
                {majorModalStep === 1 && <div className="admin-workflow-pane">
                  <label className="admin-label">
                    <span className="with-help-tip">
                      适用范围
                      <HelpTip title="适用范围">默认归属当前年级；全校统一考试会出现在所有年级绑定设备上。</HelpTip>
                    </span>
                    <InlineSelect className="admin-input" value={majorModal.targetGradeIds.length ? majorModal.targetGradeIds[0] : "all"} onChange={(value) => setMajorModal((p) => p && { ...p, targetGradeIds: value === "all" ? [] : [value] })} options={[...(hasAllScope ? [{ value: "all", label: "全校统一" }] : []), ...visibleGrades.map((grade) => ({ value: grade.id, label: grade.name }))]} />
                  </label>
                  <div className="admin-workflow-review"><span>考试名称<strong>{majorModal.name}</strong></span><span>显示范围<strong>{majorModal.targetGradeIds.length ? visibleGrades.find((grade) => grade.id === majorModal.targetGradeIds[0])?.name || "指定年级" : "全校统一"}</strong></span></div>
                  <p className="admin-major-card__hint">后台切换考试只改变编辑对象，不会覆盖大屏；客户端按绑定年级自动匹配。</p>
                </div>}
              </div>
            </div>
            <div className="admin-modal__actions">
              <button className="admin-btn" onClick={() => { if (majorModalStep) setMajorModalStep(0); else { setMajorModal(null); setMajorError(""); } }}>{majorModalStep ? "上一步" : "取消"}</button>
              {majorModalStep === 0 ? <button className="admin-btn admin-btn--primary admin-workflow-actions-spacer" onClick={() => { if (!majorModal.name.trim()) { setMajorError("请输入大型考试名称"); return; } setMajorError(""); setMajorModalStep(1); }}>下一步</button> : <button className="admin-btn admin-btn--primary admin-workflow-actions-spacer" onClick={() => commitMajorModal(() => setImportOpen(true))}>{majorModal.next === "import" ? "创建并继续导入" : "确认保存"}</button>}
            </div>
          </div>
        </AdminModalPortal>
      )}
      {quickMajorOpen && (
        <QuickMajorPublishModal
          grades={visibleGrades}
          classes={visibleClasses}
          initialGradeIds={selectedGradeId ? [selectedGradeId] : []}
          allowSchoolWide={hasAllScope}
          lockedClassName={
            adminUser.roleId === "class_admin"
              ? visibleClasses.find((item) => item.id === selectedClassId)?.name
              : undefined
          }
          lockedClassId={
            adminUser.roleId === "class_admin" ? selectedClassId : undefined
          }
          majors={visibleMajors}
          onClose={() => setQuickMajorOpen(false)}
          onPublish={publishQuickMajor}
        />
      )}
      {majorBatchAddOpen && hasScopedMajor && (
        <MajorBatchAddModal
          major={activeMajor}
          existingItems={items}
          classes={visibleClasses}
          onClose={() => setMajorBatchAddOpen(false)}
          onCommit={commitBatchMajorItems}
        />
      )}
      {majorPrintOpen && (
        <SchedulePrintPreview
          mode="major"
          title={activeMajor.name}
          entries={items
            .filter((item) => item.enabled)
            .filter(
              (item) =>
                !majorPrintClass ||
                subjectAppliesToClass(item.name, majorPrintClass),
            )
            .map((item) => ({
              date: item.startTime.slice(0, 10),
              name: item.name,
              startTime: item.startTime.slice(11, 16),
              endTime: item.endTime.slice(11, 16),
              note: STATUS[phase(item)].label,
            }))}
          gradeName={
            grades.find((grade) => grade.id === selectedGradeId)?.name ||
            activeMajorScopeLabel
          }
          className={majorPrintClass ? majorPrintClass.name : "全年级"}
          onClose={() => setMajorPrintOpen(false)}
        />
      )}
      {deleteMajorOpen && (
        <AdminModalPortal
          className="admin-modal-overlay"
          {...backdropProps(() => setDeleteMajorOpen(false))}
        >
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="admin-modal__title">删除大型考试</h2>
            <p className="admin-modal__body">
              确定删除「{activeMajor.name}」及其全部 {items.length}{" "}
              项分考试？此操作无法撤销。
            </p>
            <div className="admin-modal__actions">
              <button
                className="admin-btn admin-btn--danger"
                onClick={removeMajor}
              >
                删除
              </button>
              <button
                className="admin-btn"
                onClick={() => setDeleteMajorOpen(false)}
              >
                取消
              </button>
            </div>
          </div>
        </AdminModalPortal>
      )}
      {quickMajorDeleteTarget && (
        <AdminModalPortal
          className="admin-modal-overlay"
          {...backdropProps(() => setQuickMajorDeleteTarget(null))}
        >
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="admin-modal__title">删除临时考试</h2>
            <p className="admin-modal__body">
              确定删除“{quickMajorDeleteTarget.name}”吗？删除后无法恢复。
            </p>
            <div className="admin-modal__actions">
              <button
                className="admin-btn admin-btn--danger"
                onClick={() => removeQuickMajor(quickMajorDeleteTarget)}
              >
                删除
              </button>
              <button
                className="admin-btn"
                onClick={() => setQuickMajorDeleteTarget(null)}
              >
                取消
              </button>
            </div>
          </div>
        </AdminModalPortal>
      )}
      {deleteSelectedOpen && (
        <AdminModalPortal
          className="admin-modal-overlay"
          {...backdropProps(() => setDeleteSelectedOpen(false))}
        >
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="admin-modal__title">批量删除分考试</h2>
            <p className="admin-modal__body">
              确定删除选中的 {selectedItemIds.size} 项分考试？此操作无法撤销。
            </p>
            <div className="admin-modal__actions">
              <button
                className="admin-btn admin-btn--danger"
                onClick={() => removeItems([...selectedItemIds])}
              >
                删除
              </button>
              <button
                className="admin-btn"
                onClick={() => setDeleteSelectedOpen(false)}
              >
                取消
              </button>
            </div>
          </div>
        </AdminModalPortal>
      )}
      {deleteTarget && (
        <AdminModalPortal
          className="admin-modal-overlay"
          {...backdropProps(() => setDeleteTarget(null))}
        >
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="admin-modal__title">确认删除</h2>
            <p className="admin-modal__body">
              确定删除「{deleteTarget.name}」？此操作无法撤销。
            </p>
            <div className="admin-modal__actions">
              <button
                className="admin-btn admin-btn--danger"
                onClick={() => remove(deleteTarget)}
              >
                删除
              </button>
              <button
                className="admin-btn"
                onClick={() => setDeleteTarget(null)}
              >
                取消
              </button>
            </div>
          </div>
        </AdminModalPortal>
      )}
      {alertsOpen && can("alerts.read") && (
        <AdminModalPortal
          className="admin-modal-overlay"
          {...backdropProps(() => setAlertsOpen(false))}
        >
          <div
            className="admin-modal admin-modal--wide admin-alerts"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="admin-alerts__head">
              <h2 className="admin-modal__title" style={{ margin: 0 }}>
                <Bell size={19} />
                统一提醒管理
              </h2>
              <button
                className="admin-btn admin-btn--ghost"
                onClick={() => setAlertsOpen(false)}
              >
                关闭
              </button>
            </div>
            {!can("alerts.edit") && (
              <div className="admin-info-banner">
                当前账号只有查看权限，提醒设置不可修改。
              </div>
            )}
            <p className="admin-alerts__lead">
              开考各阶段自动弹出<strong>全屏提醒浮层</strong>；浮层风格
              <strong>自动跟随大屏当前设计</strong>（共 5 套：深色指挥舱 /
              清爽聚焦 / 校园黑板 / 高对比应急 /
              编辑排版），无需单独配置。文案支持占位符{" "}
              <code>{"{subject}"}</code>、<code>{"{start}"}</code>、
              <code>{"{end}"}</code>、<code>{"{next}"}</code>、
              <code>{"{nextTime}"}</code>。
            </p>
            <fieldset
              className="admin-permission-modal"
              disabled={!can("alerts.edit")}
            >
              <div className="admin-alerts__bar">
                <label className="admin-toggle-label">
                  <input
                    type="checkbox"
                    checked={alerts.enabled}
                    onChange={(e) => setAlertsEnabled(e.target.checked)}
                  />
                  启用全屏提醒浮层
                </label>
                <label className="admin-alerts__dur">
                  默认停留时长
                  <input
                    className="admin-input"
                    type="number"
                    min={4}
                    max={15}
                    value={alerts.durationSec}
                    onChange={(e) =>
                      setAlertsDuration(
                        Math.min(15, Math.max(4, Number(e.target.value) || 8)),
                      )
                    }
                  />
                  <span>秒</span>
                </label>
                <button
                  className="admin-btn admin-btn--ghost"
                  onClick={resetAlerts}
                >
                  恢复默认文案
                </button>
              </div>
              <div className="admin-alerts__tabs">
                <button
                  type="button"
                  className={alertsSection === "builtin" ? "is-active" : ""}
                  onClick={() => setAlertsSection("builtin")}
                >
                  内置阶段提醒
                </button>
                <button
                  type="button"
                  className={alertsSection === "custom" ? "is-active" : ""}
                  onClick={() => setAlertsSection("custom")}
                >
                  自定义提醒（{alerts.custom.length}）
                </button>
              </div>

              {alertsSection === "builtin" && (
                <div
                  className={`admin-alerts__section${alerts.enabled ? "" : " is-dim"}`}
                >
                  <h3 className="admin-alerts__subtitle">
                    内置阶段提醒（6 项）
                  </h3>
                  <div className="admin-alerts__grid">
                    {ALERT_STATE_ORDER.map((st) => {
                      const cfg = alerts.states[st];
                      const meta = ALERT_STATE_META[st];
                      return (
                        <div
                          className={`admin-alert-card${cfg.enabled ? "" : " is-off"}`}
                          key={st}
                        >
                          <div className="admin-alert-card__head">
                            <div>
                              <span className="admin-alert-card__name">
                                {meta.name}
                              </span>
                              <span className="admin-alert-card__timing">
                                {meta.timing}
                              </span>
                            </div>
                            <label className="admin-switch">
                              <input
                                type="checkbox"
                                checked={cfg.enabled}
                                onChange={(e) =>
                                  updateStateCfg(st, {
                                    enabled: e.target.checked,
                                  })
                                }
                              />
                              <span />
                            </label>
                          </div>
                          <div className="admin-alert-card__fields">
                            <label>
                              状态标签
                              <input
                                className="admin-input"
                                value={cfg.label}
                                onChange={(e) =>
                                  updateStateCfg(st, { label: e.target.value })
                                }
                              />
                            </label>
                            <label>
                              主文案
                              <input
                                className="admin-input"
                                value={cfg.title}
                                onChange={(e) =>
                                  updateStateCfg(st, { title: e.target.value })
                                }
                              />
                            </label>
                            <label>
                              副提示
                              <input
                                className="admin-input"
                                value={cfg.subtext}
                                onChange={(e) =>
                                  updateStateCfg(st, {
                                    subtext: e.target.value,
                                  })
                                }
                              />
                            </label>
                            {(st === "start" || st === "ended") && (
                              <label>
                                主视觉文字
                                <input
                                  className="admin-input"
                                  value={cfg.hero ?? ""}
                                  onChange={(e) =>
                                    updateStateCfg(st, { hero: e.target.value })
                                  }
                                />
                              </label>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {alertsSection === "custom" && (
                <div
                  className={`admin-alerts__section${alerts.enabled ? "" : " is-dim"}`}
                >
                  <div className="admin-alerts__section-head">
                    <h3 className="admin-alerts__subtitle">
                      自定义提醒（{alerts.custom.length}）
                    </h3>
                    <button
                      className="admin-btn admin-btn--primary"
                      onClick={addCustomReminder}
                    >
                      + 添加提醒
                    </button>
                  </div>
                  {alerts.custom.length === 0 ? (
                    <p className="admin-alerts__empty">
                      暂无自定义提醒。可添加如「开考前 30 分钟入场」「结束前 5
                      分钟」等提示。
                    </p>
                  ) : (
                    <div className="admin-alerts__custom">
                      {alerts.custom.map((c) => (
                        <div
                          className={`admin-alert-card${c.enabled ? "" : " is-off"}`}
                          key={c.id}
                        >
                          <div className="admin-alert-card__head">
                            <input
                              className="admin-input admin-alert-card__title-input"
                              value={c.name}
                              onChange={(e) =>
                                updateCustomReminder(c.id, {
                                  name: e.target.value,
                                })
                              }
                              placeholder="提醒名称"
                            />
                            <div className="admin-alert-card__head-actions">
                              <label className="admin-switch">
                                <input
                                  type="checkbox"
                                  checked={c.enabled}
                                  onChange={(e) =>
                                    updateCustomReminder(c.id, {
                                      enabled: e.target.checked,
                                    })
                                  }
                                />
                                <span />
                              </label>
                              <button
                                className="admin-item-btn admin-item-btn--delete"
                                onClick={() => removeCustomReminder(c.id)}
                              >
                                删除
                              </button>
                            </div>
                          </div>
                          <div className="admin-alert-card__row">
                            <label>
                              触发
                              <InlineSelect
                                className="admin-input"
                                value={c.anchor}
                                onChange={(value) =>
                                  updateCustomReminder(c.id, {
                                    anchor: value as CustomReminder["anchor"],
                                  })
                                }
                                options={ANCHOR_OPTIONS.map((o) => ({
                                  value: o.value,
                                  label: o.label,
                                }))}
                              />
                            </label>
                            <label>
                              分钟
                              <input
                                className="admin-input"
                                type="number"
                                min={0}
                                max={600}
                                value={c.offsetMin}
                                onChange={(e) =>
                                  updateCustomReminder(c.id, {
                                    offsetMin: Math.max(
                                      0,
                                      Number(e.target.value) || 0,
                                    ),
                                  })
                                }
                              />
                            </label>
                            <label>
                              配色
                              <InlineSelect
                                className="admin-input"
                                value={c.tone}
                                onChange={(value) =>
                                  updateCustomReminder(c.id, {
                                    tone: value as AlertState,
                                  })
                                }
                                options={TONE_OPTIONS.map((o) => ({
                                  value: o.value,
                                  label: o.label,
                                }))}
                              />
                            </label>
                          </div>
                          <div className="admin-alert-card__fields">
                            <label>
                              状态标签
                              <input
                                className="admin-input"
                                value={c.label}
                                onChange={(e) =>
                                  updateCustomReminder(c.id, {
                                    label: e.target.value,
                                  })
                                }
                              />
                            </label>
                            <label>
                              主文案
                              <input
                                className="admin-input"
                                value={c.title}
                                onChange={(e) =>
                                  updateCustomReminder(c.id, {
                                    title: e.target.value,
                                  })
                                }
                              />
                            </label>
                            <label>
                              副提示
                              <input
                                className="admin-input"
                                value={c.subtext}
                                onChange={(e) =>
                                  updateCustomReminder(c.id, {
                                    subtext: e.target.value,
                                  })
                                }
                              />
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </fieldset>
          </div>
        </AdminModalPortal>
      )}
      {announceOpen && (
        <AdminModalPortal
          className="admin-modal-overlay"
          {...backdropProps(() => setAnnounceOpen(false))}
        >
          <div
            className="admin-modal admin-modal--wide admin-announce"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="admin-alerts__head">
              <h2 className="admin-modal__title" style={{ margin: 0 }}>
                <Megaphone size={19} />
                公告
              </h2>
              <button
                className="admin-btn admin-btn--ghost"
                onClick={() => setAnnounceOpen(false)}
              >
                关闭
              </button>
            </div>
            <p className="admin-alerts__lead">
              公告由作者端统一发布，内容以 Markdown 渲染；本页仅供查看。
            </p>
            {annLoading ? (
              <div className="admin-announce__empty">公告加载中…</div>
            ) : anns.length === 0 ? (
              <div className="admin-announce__empty">暂无公告。</div>
            ) : (
              <AnnouncementList announcements={anns} formatTime={fmtAnnTime} />
            )}
          </div>
        </AdminModalPortal>
      )}
      {importOpen && hasScopedMajor && (
        <AdminModalPortal
          className="admin-modal-overlay"
          {...backdropProps(() => {
            setImportOpen(false);
            setOpenImportGuide(false);
          })}
        >
          <div
            className="admin-modal admin-modal--wide admin-modal--workflow"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="admin-modal__title admin-workflow-head">导入分考试 JSON</h2>
            <AdminWorkflowClose onClick={() => { setImportOpen(false); setOpenImportGuide(false); setImportError(""); setMajorImportPreview(null); }} />
            {importError && <div className="admin-error">{importError}</div>}
            <div className="admin-workflow-layout">
              <AdminWizardSteps active={majorImportStep} steps={[{ label: "准备内容", hint: "查看格式或生成提示词" }, { label: "粘贴校验", hint: "解析分考试 JSON" }, { label: "预览结果", hint: "检查风险后导入" }]} summary={<><span>导入到</span><strong>{majorImportPreview?.title || activeMajor.name}</strong><span>{majorImportPreview ? `${majorImportPreview.items.filter((item) => item.include).length} 项待导入` : activeMajorScopeLabel}</span></>} />
              <div className="admin-workflow-content" key={majorImportStep}>
                {majorImportStep === 0 && <div className="admin-workflow-pane"><p className="admin-modal__body">支持纯数组，或含 <code>title</code> 与 <code>items</code> 的对象。导入时会校验字段并按开始时间排序。</p><AiImportGuide kind="major" context={`${initialization.schoolFullName || "当前学校"}，${activeMajorScopeLabel}，大型考试“${activeMajor.name}”`} targetTitle={activeMajor.name} initiallyOpen={openImportGuide} /></div>}
                {majorImportStep === 1 && <div className="admin-workflow-pane"><label className="admin-label">考试安排 JSON<textarea className="admin-textarea" rows={11} value={importText} onChange={(e) => { setImportText(e.target.value); setMajorImportPreview(null); }} placeholder='{"title":"2026年高考","items":[{"name":"语文","startTime":"2026-06-07T09:00:00","endTime":"2026-06-07T11:30:00","enabled":true}]}' /></label></div>}
                {majorImportStep === 2 && majorImportPreview && <div className="admin-workflow-pane"><h3 className="admin-modal__title">预览导入结果</h3>{majorImportPreview.warnings.length ? <div className="admin-error">{majorImportPreview.warnings.join("；")}</div> : <p className="admin-major-card__hint">时间格式和顺序校验通过。取消勾选可跳过单项。</p>}<div className="admin-import-preview">{majorImportPreview.items.map((item, index) => <label key={`${item.id}-${index}`} className={item.include ? "" : "is-skipped"}><input type="checkbox" checked={item.include} onChange={(event) => setMajorImportPreview((value) => value && { ...value, items: value.items.map((current, itemIndex) => itemIndex === index ? { ...current, include: event.target.checked } : current) })} /><span><strong>{item.name}</strong><small>{fmtLocal(item.startTime)} - {fmtLocal(item.endTime)} · {duration(item.startTime, item.endTime)}</small></span></label>)}</div></div>}
              </div>
            </div>
            <div className="admin-modal__actions">
              <button className="admin-btn" onClick={() => { if (majorImportStep) setMajorImportStep((value) => value - 1); else { setImportOpen(false); setOpenImportGuide(false); setImportError(""); setMajorImportPreview(null); } }}>{majorImportStep ? "上一步" : "取消"}</button>
              {majorImportStep === 0 ? <button className="admin-btn admin-btn--primary admin-workflow-actions-spacer" onClick={() => setMajorImportStep(1)}>下一步，粘贴 JSON</button> : majorImportStep === 1 ? <button className="admin-btn admin-btn--primary admin-workflow-actions-spacer" onClick={validateMajorImportJson}>校验并预览</button> : <button className="admin-btn admin-btn--primary admin-workflow-actions-spacer" disabled={!majorImportPreview?.items.some((item) => item.include)} onClick={importJson}>确认导入 {majorImportPreview?.items.filter((item) => item.include).length || 0} 项</button>}
            </div>
          </div>
        </AdminModalPortal>
      )}
      {editing && <TimeRangePickerModal
        open={majorTimeFlowOpen}
        mode="datetime"
        startValue={editing.startTime}
        endValue={editing.endTime}
        subject={editing.name || "分考试"}
        presets={MAJOR_DURATION_PRESETS}
        initialCrossDay={editing.startTime.slice(0, 10) !== editing.endTime.slice(0, 10)}
        anchorRef={majorTimeFlowAnchorRef}
        onPreviewChange={(startTime, endTime) => {
          setEditing((value) => value ? { ...value, startTime, endTime } : value);
        }}
        onPreviewCancel={(startTime, endTime) => {
          setEditing((value) => value ? { ...value, startTime, endTime } : value);
        }}
        onCancel={cancelMajorTimeFlow}
        onConfirm={(startTime, endTime) => {
          setLongDurationConfirmed(false);
          setEditing((value) => value ? { ...value, startTime, endTime } : value);
          setMajorTimeFlowOpen(false);
        }}
      />}
      {can("initialization.run") && (
        <InitializationWizard
          open={wizardOpen}
          onClose={() => setWizardOpen(false)}
          onComplete={completeInitialization}
          onFinalized={finalizeInitialization}
        />
      )}
      {new URLSearchParams(location.search).get("allowIncomplete") === "1" &&
        cloudReadConfirmed &&
        can("initialization.run") &&
        (!initialization.completedAt ||
          !initialization.schoolFullName ||
          grades.length === 0 ||
          classes.length === 0 ||
          recoveryConfigured === false) && (
          <aside
            className="admin-incomplete-prompt"
            role="alert"
            aria-live="assertive"
          >
            <strong>初始化尚未完整完成</strong>
            <p>这是应急进入管理页模式。以下设置仍需补充，提醒会一直保留：</p>
            <ul>
              {!initialization.schoolFullName && <li>学校名称与省份</li>}
              {grades.length === 0 && <li>至少一个年级</li>}
              {classes.length === 0 && <li>至少一个班级</li>}
              {!initialization.completedAt && (
                <li>学期、调度规则和初始化确认</li>
              )}
              {recoveryConfigured === false && (
                <li>自动生成并安全保存超级管理员恢复密钥</li>
              )}
            </ul>
            <div>
              <button
                className="admin-btn admin-btn--primary"
                onClick={() => setWizardOpen(true)}
              >
                继续完整初始化
              </button>
              <button
                className="admin-btn"
                onClick={() => setAdminTab("classes")}
              >
                打开年级与班级
              </button>
            </div>
            <small>补齐全部项目后，请使用普通管理地址重新登录。</small>
          </aside>
        )}
    </div>
  );
}
