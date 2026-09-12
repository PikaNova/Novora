import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Watermark from '../components/Watermark';
import {
  isOwnQuickTemporaryMajor as isOwnQuickTemporaryMajorCheck,
  isQuickTemporaryMajorFullyInScope,
} from '../utils/majorOwnership';
import type { MajorExam } from '../types';
import { getAppSettings, updateExamSettings } from '../utils/appSettings';
import { adminCan, getCloudSnapshot, saveExamsToServer, takeGeneratedRecoveryKey } from '../services/examService';
import { clearPendingExamSync } from '../services/examOutbox';
import AdminDeviceSetupPrompt from '../components/AdminDeviceSetupPrompt';
import InitializationWizard, {
  type InitializationCompletion,
  type InitializationPasswordChange,
} from '../components/InitializationWizard';
import AccessDenied from '../components/AccessDenied';
import SchedulePrintPreview from '../components/SchedulePrintPreview';
import LoadingState from '../components/LoadingState';
import QuickMajorPublishModal from '../components/QuickMajorPublishModal';
import MajorBatchAddModal from '../components/MajorBatchAddModal';
import TimeRangePickerModal from '../components/TimeRangePickerModal';
import { notify } from '../services/notify';
import { formatApiError } from '../services/apiError';
import { changeOwnPassword } from '../services/adminUsers';
import type { InitializationResult } from '../utils/initializationData';
import { useBackdropDismiss } from '../hooks/useBackdropDismiss';
import type { AdminTab } from '../types/exam';
import { subjectAppliesToClass } from '../types/school';
import '../styles/admin.css';
import '../styles/admin-wizard-mobile-fix.css';
import '../styles/admin-track-additions.css';
import { fmtAnnTime, phase, syncMajorStateRef } from '../hooks/admin/adminPageUtils';
import { findMajorConflicts, findMajorConflictItemKeys } from '../utils/examConflicts';
import type { SyncState } from '../hooks/admin/adminPageUtils';
import type { ExamSavePayload } from '../shared/examContracts';
import { useAdminAuthSession } from '../hooks/admin/useAdminAuthSession';
import { useAnnouncements } from '../hooks/admin/useAnnouncements';
import { useAdminModals, ADMIN_NAV } from '../hooks/admin/useAdminModals';
import { useInitializationWizard } from '../hooks/admin/useInitializationWizard';
import { useAlertsSettings } from '../hooks/admin/useAlertsSettings';
import { useWeeklyScheduleSync } from '../hooks/admin/useWeeklyScheduleSync';
import { useMajorScheduleActions } from '../hooks/admin/useMajorScheduleActions';
import { useExamItemActions } from '../hooks/admin/useExamItemActions';
import { useSchoolStructureActions } from '../hooks/admin/useSchoolStructureActions';
import { useMajorImportExport } from '../hooks/admin/useMajorImportExport';
import { useAdminSyncEngine } from '../hooks/admin/useAdminSyncEngine';

import MajorTabPanel, { STATUS } from '../components/major/MajorTabPanel';
import { AdminHeader, AdminMobileNav, SYNC_META } from '../components/admin/AdminChrome';
import { MajorModalWizard } from '../components/admin/MajorModalWizard';
import { AlertsSettingsModal } from '../components/admin/AlertsSettingsModal';
import { AdminTabBar } from '../components/admin/AdminTabBar';
import { AdminContextBar } from '../components/admin/AdminContextBar';
import { AdminAnnounceDialog } from '../components/admin/AdminAnnounceDialog';
import { AdminIncompletePrompt } from '../components/admin/AdminIncompletePrompt';
import { AiImportModal } from '../components/admin/AiImportModal';
import { GradeAdminSetupPromptModal } from '../components/admin/GradeAdminSetupPromptModal';
import ExamRecordsPanel from '../components/ExamRecordsPanel';
import {
  DeleteItemConfirm,
  DeleteMajorConfirm,
  DeleteQuickMajorConfirm,
  DeleteSelectedConfirm,
} from '../components/admin/AdminConfirmDialogs';

const OverviewPanel = lazy(() => import('../components/OverviewPanel'));
const DashboardPanel = lazy(() => import('../components/DashboardPanel'));
const WeeklyPanel = lazy(() => import('../components/WeeklyPanel'));
const ClassManagementPanel = lazy(() => import('../components/ClassManagementPanel'));
const DeviceStatusPanel = lazy(() => import('../components/DeviceStatusPanel'));
const UserManagementPanel = lazy(() => import('../components/UserManagementPanel'));

const MAJOR_DURATION_PRESETS = [45, 60, 75, 90, 120, 150];

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
  const commitRef = useRef<(ms: MajorExam[], activeId: string, immediate?: boolean, syncLabel?: string) => void>(
    () => {},
  );
  const buildPayloadRef = useRef<(ms: MajorExam[], activeId: string) => ExamSavePayload>(() => ({}));
  const setMajorsRef = useRef<(ms: MajorExam[]) => void>(() => {});
  const setActiveMajorIdRef = useRef<(id: string) => void>(() => {});
  const editingRef = useRef<{ name: string } | null>(null);
  const setEditingRef = useRef<(value: unknown) => void>(() => {});

  // ---- 云同步基础状态（多个领域 Hook 都需要写入，故不归属单个 Hook）----
  const [sync, setSync] = useState<SyncState>('loading');
  const [cloudReadConfirmed, setCloudReadConfirmed] = useState(false);
  const [online, setOnline] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [recoveryConfigured, setRecoveryConfigured] = useState<boolean | null>(null);
  const [adminNow, setAdminNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setAdminNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  // ---- 领域 Hook 编排（顺序即依赖顺序）----
  const auth = useAdminAuthSession();
  const {
    ready,
    setReady,
    adminUser,
    setAdminUser,
    currentDeviceBinding,
    gradeAdminSetupPromptOpen,
    setGradeAdminSetupPromptOpen,
  } = auth;

  const announcements = useAnnouncements();
  const { announceOpen, setAnnounceOpen, anns, annLoading } = announcements;

  const defaultTab: AdminTab = initial.grades.length === 0 || initial.classes.length === 0 ? 'classes' : 'overview';
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
  const { initialization, setInitialization, initializationRef, wizardOpen, setWizardOpen, finalizeInitialization } =
    wizard;

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
    initialSelectedGradeId: initial.selectedGradeId || initial.grades[0]?.id || '',
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
    scopedMajors,
    orderedScopedMajors,
    hasScopedMajor,
    activeMajor,
    items,
    subjectTrackModeEnabled,
    autoTrackClassIdsForMajorItem,
    activeMajorTrackSubjects,
    activeMajorTrackScopedCount,
    activeMajorUnsetTrackClassCount,
    changeSelectedGrade,
    changeSelectedClass,
    buildPayload,
    pushToServer,
    commit,
    commitItems,
    commitBatchMajorItems,
    switchMajor,
    commitMajorModal,
    removeMajor,
    removeQuickMajor,
    publishQuickMajor,
    extendQuickMajor,
    endQuickMajor,
    promoteQuickMajor,
  } = major;
  const majorConflictLabels = findMajorConflicts(scopedMajors);
  const majorConflictItemKeys = findMajorConflictItemKeys(scopedMajors);
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
  const { addGrade, addClass, addClasses, removeClass, removeClasses, removeGrade, updateClassesTrack } = school;

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
    const active = result.majors.find((item) => item.id === result.activeMajorId) ?? result.majors[0];
    const payload = {
      items: active?.items ?? [],
      title: active?.name ?? '',
      majors: result.majors,
      activeMajorId: result.activeMajorId,
      alerts: alertsRef.current,
      ...nextWeekly,
      initialization: result.initialization,
    };
    const alreadySaved = !!initializationRef.current.completedAt && grades.length > 0 && classes.length > 0;
    if (!alreadySaved) {
      setSync('saving');
      const saved = await saveExamsToServer({
        ...payload,
        action: 'initialize',
        baseUpdatedAt: getCloudSnapshot()?.updatedAt ?? 0,
      });
      if (saved === 'unauthorized') {
        navigate('/login?mode=initialize&next=/admin%3Finitialize%3D1', {
          replace: true,
        });
        return { ok: false, error: '登录状态已失效，请重新登录后继续初始化' };
      }
      if (typeof saved !== 'number') {
        setSync('error');
        const message =
          saved && saved.kind === 'error' ? formatApiError(saved.error) : '初始化数据未能写入云端，请刷新后重试。';
        notify('error', message, '初始化失败');
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
      setSelectedGradeId('');
      setSelectedClassId('');
      setInitialization(result.initialization);
      syncMajorStateRef(stateRef, result.majors, result.activeMajorId);
      weeklyStateRef.current = nextWeekly;
      initializationRef.current = result.initialization;
      updateExamSettings({
        ...payload,
        selectedGradeId: '',
        selectedClassId: '',
        updatedAt: saved,
      });
      clearPendingExamSync();
      pendingRef.current = false;
      setSync('saved');
    }
    try {
      await changeOwnPassword(passwordChange.currentPassword, passwordChange.newPassword);
    } catch (error) {
      const message = error instanceof Error ? error.message : '超级管理员密码修改失败';
      notify('error', message, '学校信息已保存，请重新确认当前密码');
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
          setDeniedModule('');
          navigate('/admin', { replace: true });
        }}
      />
    );

  const can = (permission: string) => adminCan(permission, adminUser);
  const isOwnQuickTemporaryMajor = (major: MajorExam) => isOwnQuickTemporaryMajorCheck(major, adminUser?.id);
  const canEndQuickTemporaryMajorInScope = (major: MajorExam) =>
    isQuickTemporaryMajorFullyInScope(
      major,
      (classId) => visibleClasses.some((item) => item.id === classId),
      (gradeId) => visibleGrades.some((item) => item.id === gradeId),
    );
  const canEditActiveMajor = can('major.edit') || (can('major.quick_create') && isOwnQuickTemporaryMajor(activeMajor));
  const canDeleteActiveMajor =
    can('major.delete') || (can('major.quick_create') && isOwnQuickTemporaryMajor(activeMajor));
  const canQuickPublish = can('major.create') || can('major.quick_create');
  const openMyAccount = () => {
    setDeniedModule('');
    navigate('/admin?tab=users&account=1');
    setAdminTab('users');
    setMoreOpen(false);
  };
  const selectAdminTab = (item: (typeof ADMIN_NAV)[number]) => {
    if (item.id === 'users' && !can(item.permission)) {
      openMyAccount();
      return;
    }
    if (!can(item.permission)) {
      setDeniedModule(item.label);
      return;
    }
    setDeniedModule('');
    setAdminTab(item.id);
  };
  const editDurationMs =
    editing?.startTime && editing?.endTime
      ? new Date(editing.endTime).getTime() - new Date(editing.startTime).getTime()
      : 0;
  const isLongEdit = Number.isFinite(editDurationMs) && editDurationMs > 6 * 60 * 60 * 1000;
  const activeMajorScopeLabel = activeMajor.targetClassIds?.length
    ? `指定 ${activeMajor.targetClassIds.length} 个班级`
    : activeMajor.targetGradeIds?.length
      ? activeMajor.targetGradeIds.map((id) => grades.find((grade) => grade.id === id)?.name || id).join('、')
      : '全校';
  // 预览与导出 PDF 时，若当前正查看某个具体班级，按该班级的选科结果实时过滤
  // 科目，而不是展示整个大型考试范围内的全部科目（修复选科结果未下发到
  // 考试安排预览的问题）。
  const majorPrintClass = selectedClassId ? visibleClasses.find((item) => item.id === selectedClassId) : undefined;
  const quickScopedMajors = orderedScopedMajors.filter(
    (major) =>
      major.temporary &&
      !major.endedAt &&
      major.items.some((item) => item.enabled && new Date(item.endTime).getTime() >= adminNow),
  );

  return (
    <div className="admin-page">
      <AdminDeviceSetupPrompt
        user={adminUser}
        grades={visibleGrades}
        classes={visibleClasses}
        canBind={can('device.bind')}
      />
      <Watermark />
      <AdminHeader
        adminUser={adminUser}
        sync={sync}
        online={online}
        alertsEnabled={alerts.enabled}
        canQuickPublish={canQuickPublish}
        canCreateMajor={can('major.create')}
        canBatchAdd={adminUser.roleId === 'grade_admin' && can('user.create')}
        canReadAlerts={can('alerts.read')}
        canShowSettings={
          can('settings.read') &&
          (can('settings.edit') ||
            can('weekly.edit') ||
            can('majorBatch.preset_edit') ||
            can('alerts.edit') ||
            can('initialization.run'))
        }
        canExportMajor={adminTab === 'major' && can('major.export')}
        showInitialization={
          can('initialization.run') && (!initialization.completedAt || grades.length === 0 || classes.length === 0)
        }
        showMajorChip={hasScopedMajor && adminTab === 'major'}
        currentDeviceBinding={currentDeviceBinding}
        adminTab={adminTab}
        activeMajorName={activeMajor.name}
        activeMajorScopeLabel={activeMajorScopeLabel}
        itemsCount={items.length}
        moreOpen={moreOpen}
        moreTriggerRef={moreTriggerRef}
        moreMenuStyle={moreMenuStyle}
        placeMoreMenu={placeMoreMenu}
        setMoreOpen={setMoreOpen}
        can={can}
        onSelectAdminTab={selectAdminTab}
        onOpenMyAccount={openMyAccount}
        onOpenBatchAdd={() => {
          navigate('/admin?tab=users&batch=1');
          setAdminTab('users');
        }}
        onQuickMajorOpen={() => setQuickMajorOpen(true)}
        onAlertsOpen={() => setAlertsOpen(true)}
        onAnnounceOpen={() => setAnnounceOpen(true)}
        onWizardOpen={() => setWizardOpen(true)}
        onExportJson={exportJson}
      />
      <div className="admin-workspace">
        <AdminTabBar
          adminTab={adminTab}
          can={can}
          selectAdminTab={selectAdminTab}
          visibleWeeklyPlans={visibleWeeklyPlans}
        />
        <div className="admin-content">
          {(adminTab === 'major' || adminTab === 'weekly') && (
            <AdminContextBar
              adminTab={adminTab}
              can={can}
              scheduleMode={scheduleMode}
              handleScheduleModeChange={handleScheduleModeChange}
              selectedGradeId={selectedGradeId}
              changeSelectedGrade={changeSelectedGrade}
              visibleGrades={visibleGrades}
              selectedClassId={selectedClassId}
              changeSelectedClass={changeSelectedClass}
              visibleClasses={visibleClasses}
            />
          )}
          <div
            key={adminTab}
            className={`admin-body admin-tab-transition${(['overview', 'dashboard', 'records', 'classes', 'devices', 'users'] as AdminTab[]).includes(adminTab) ? ' admin-body--wide' : ''}`}
          >
            <Suspense fallback={<LoadingState kind="loading" layout="panel" />}>
              {adminTab === 'overview' ? (
                <OverviewPanel
                  user={adminUser}
                  grades={visibleGrades}
                  classes={visibleClasses}
                  majors={visibleMajors}
                  weeklyPlans={visibleWeeklyPlans}
                  syncState={sync}
                  syncLabel={SYNC_META[sync].label}
                  online={online}
                  onQuickPublish={canQuickPublish ? () => setQuickMajorOpen(true) : undefined}
                />
              ) : adminTab === 'dashboard' ? (
                <DashboardPanel />
              ) : adminTab === 'records' ? (
                <ExamRecordsPanel grades={visibleGrades} classes={visibleClasses} />
              ) : adminTab === 'weekly' ? (
                <fieldset className="admin-permission-fieldset" disabled={!can('weekly.edit')}>
                  <WeeklyPanel
                    weeklyPlans={visibleWeeklyPlans}
                    activeWeeklyPlanId={activeWeeklyPlanId}
                    activeWeeklyPlanIdByClassId={activeWeeklyPlanIdByClassId}
                    selectedGradeId={selectedGradeId}
                    selectedClassId={selectedClassId}
                    selectedClassName={visibleClasses.find((item) => item.id === selectedClassId)?.name ?? '当前班级'}
                    classOptions={visibleClasses.map((item) => ({
                      id: item.id,
                      gradeId: item.gradeId,
                      label: `${visibleGrades.find((grade) => grade.id === item.gradeId)?.name ?? '未知年级'} · ${item.name}`,
                    }))}
                    scheduleMode={scheduleMode}
                    weeklyConflictPolicy={weeklyConflictPolicy}
                    majorItems={orderedScopedMajors.flatMap((major) => major.items)}
                    majorName={orderedScopedMajors.map((major) => major.name).join('、')}
                    onSavePlans={handleSaveWeeklyPlans}
                    onConflictPolicyChange={handleConflictPolicyChange}
                    canEditConflictPolicy={can('schedule.conflict_edit')}
                    onSelectScope={(gradeId, classId) => {
                      setSelectedGradeId(gradeId);
                      setSelectedClassId(classId);
                    }}
                    allowBatchApply={can('weekly.copy') && visibleClasses.length > 1}
                  />
                </fieldset>
              ) : adminTab === 'classes' ? (
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
                  canManageGrades={can('school.grade_manage')}
                  canManageClasses={can('school.class_manage')}
                />
              ) : adminTab === 'devices' ? (
                <DeviceStatusPanel
                  canRevoke={can('device.revoke')}
                  canBind={can('device.bind')}
                  canEditDesign={hasAllScope && can('settings.edit')}
                />
              ) : adminTab === 'users' ? (
                <UserManagementPanel
                  grades={visibleGrades}
                  classes={visibleClasses}
                  currentUser={adminUser}
                  forcePasswordChange={
                    adminUser.mustChangePassword || new URLSearchParams(location.search).get('password') === '1'
                  }
                  openBatchCreate={new URLSearchParams(location.search).get('batch') === '1'}
                />
              ) : (
                <MajorTabPanel
                  grades={grades}
                  selectedGradeId={selectedGradeId}
                  orderedScopedMajors={orderedScopedMajors}
                  activeMajor={activeMajor}
                  items={items}
                  canQuickPublish={canQuickPublish}
                  can={can}
                  switchMajor={switchMajor}
                  isOwnQuickTemporaryMajor={isOwnQuickTemporaryMajor}
                  setQuickMajorOpen={setQuickMajorOpen}
                  setMajorModal={setMajorModal}
                  setMajorError={setMajorError}
                  hasScopedMajor={hasScopedMajor}
                  canDeleteActiveMajor={canDeleteActiveMajor}
                  majors={majors}
                  setDeleteMajorOpen={setDeleteMajorOpen}
                  activeMajorTrackSubjects={activeMajorTrackSubjects}
                  subjectTrackModeEnabled={subjectTrackModeEnabled}
                  activeMajorTrackScopedCount={activeMajorTrackScopedCount}
                  activeMajorUnsetTrackClassCount={activeMajorUnsetTrackClassCount}
                  quickScopedMajors={quickScopedMajors}
                  adminNow={adminNow}
                  visibleClasses={visibleClasses}
                  canEndQuickTemporaryMajorInScope={canEndQuickTemporaryMajorInScope}
                  extendQuickMajor={extendQuickMajor}
                  endQuickMajor={endQuickMajor}
                  promoteQuickMajor={promoteQuickMajor}
                  setQuickMajorDeleteTarget={setQuickMajorDeleteTarget}
                  canEditActiveMajor={canEditActiveMajor}
                  editing={editing}
                  editError={editError}
                  customSubjectActive={customSubjectActive}
                  setCustomSubjectActive={setCustomSubjectActive}
                  setEditing={setEditing}
                  setEditError={setEditError}
                  majorTimeFlowAnchorRef={majorTimeFlowAnchorRef}
                  openMajorStartTimeFlow={openMajorStartTimeFlow}
                  isLongEdit={isLongEdit}
                  longDurationConfirmed={longDurationConfirmed}
                  setLongDurationConfirmed={setLongDurationConfirmed}
                  commitEdit={commitEdit}
                  setMajorTimeFlowOpen={setMajorTimeFlowOpen}
                  setMajorTimeFlowInitialEnd={setMajorTimeFlowInitialEnd}
                  setMajorBatchAddOpen={setMajorBatchAddOpen}
                  majorConflictLabels={majorConflictLabels}
                  selectedItemIds={selectedItemIds}
                  collapsedList={collapsedList}
                  setDeleteSelectedOpen={setDeleteSelectedOpen}
                  openMajorImport={openMajorImport}
                  setMajorPrintOpen={setMajorPrintOpen}
                  setCollapsedList={setCollapsedList}
                  lastDeletedExam={lastDeletedExam}
                  restoreExam={restoreExam}
                  majorConflictItemKeys={majorConflictItemKeys}
                  setSelectedItemIds={setSelectedItemIds}
                  setExamEnabled={setExamEnabled}
                  setDeleteTarget={setDeleteTarget}
                />
              )}
            </Suspense>
          </div>
        </div>
      </div>
      <AdminMobileNav adminTab={adminTab} can={can} onSelectAdminTab={selectAdminTab} onOpenMyAccount={openMyAccount} />
      {gradeAdminSetupPromptOpen && (
        <GradeAdminSetupPromptModal
          visibleGrades={visibleGrades}
          setGradeAdminSetupPromptOpen={setGradeAdminSetupPromptOpen}
          setAdminTab={setAdminTab}
        />
      )}
      {majorModal && (
        <MajorModalWizard
          majorModal={majorModal}
          setMajorModal={setMajorModal}
          majorModalStep={majorModalStep}
          setMajorModalStep={setMajorModalStep}
          majorError={majorError}
          setMajorError={setMajorError}
          visibleGrades={visibleGrades}
          hasAllScope={hasAllScope}
          backdropProps={backdropProps}
          commitMajorModal={commitMajorModal}
          setImportOpen={setImportOpen}
        />
      )}
      {quickMajorOpen && (
        <QuickMajorPublishModal
          grades={visibleGrades}
          classes={visibleClasses}
          initialGradeIds={selectedGradeId ? [selectedGradeId] : []}
          allowSchoolWide={hasAllScope}
          lockedClassName={
            adminUser.roleId === 'class_admin'
              ? visibleClasses.find((item) => item.id === selectedClassId)?.name
              : undefined
          }
          lockedClassId={adminUser.roleId === 'class_admin' ? selectedClassId : undefined}
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
            .filter((item) => !majorPrintClass || subjectAppliesToClass(item.name, majorPrintClass))
            .map((item) => ({
              date: item.startTime.slice(0, 10),
              name: item.name,
              startTime: item.startTime.slice(11, 16),
              endTime: item.endTime.slice(11, 16),
              note: STATUS[phase(item)].label,
            }))}
          gradeName={grades.find((grade) => grade.id === selectedGradeId)?.name || activeMajorScopeLabel}
          className={majorPrintClass ? majorPrintClass.name : '全年级'}
          onClose={() => setMajorPrintOpen(false)}
        />
      )}
      {deleteMajorOpen && (
        <DeleteMajorConfirm
          activeMajor={activeMajor}
          items={items}
          removeMajor={removeMajor}
          setDeleteMajorOpen={setDeleteMajorOpen}
          backdropProps={backdropProps}
        />
      )}
      {quickMajorDeleteTarget && (
        <DeleteQuickMajorConfirm
          quickMajorDeleteTarget={quickMajorDeleteTarget}
          removeQuickMajor={removeQuickMajor}
          setQuickMajorDeleteTarget={setQuickMajorDeleteTarget}
          backdropProps={backdropProps}
        />
      )}
      {deleteSelectedOpen && (
        <DeleteSelectedConfirm
          selectedItemIds={selectedItemIds}
          removeItems={removeItems}
          setDeleteSelectedOpen={setDeleteSelectedOpen}
          backdropProps={backdropProps}
        />
      )}
      {deleteTarget && (
        <DeleteItemConfirm
          deleteTarget={deleteTarget}
          remove={remove}
          setDeleteTarget={setDeleteTarget}
          backdropProps={backdropProps}
        />
      )}
      {alertsOpen && can('alerts.read') && (
        <AlertsSettingsModal
          alerts={alerts}
          setAlertsOpen={setAlertsOpen}
          alertsSection={alertsSection}
          setAlertsSection={setAlertsSection}
          setAlertsEnabled={setAlertsEnabled}
          setAlertsDuration={setAlertsDuration}
          updateStateCfg={updateStateCfg}
          addCustomReminder={addCustomReminder}
          updateCustomReminder={updateCustomReminder}
          removeCustomReminder={removeCustomReminder}
          resetAlerts={resetAlerts}
          can={can}
          backdropProps={backdropProps}
        />
      )}
      {announceOpen && (
        <AdminAnnounceDialog
          anns={anns}
          annLoading={annLoading}
          formatTime={fmtAnnTime}
          backdropProps={backdropProps}
          setAnnounceOpen={setAnnounceOpen}
        />
      )}
      {importOpen && hasScopedMajor && (
        <AiImportModal
          importError={importError}
          importText={importText}
          majorImportPreview={majorImportPreview}
          majorImportStep={majorImportStep}
          openImportGuide={openImportGuide}
          activeMajor={activeMajor}
          activeMajorScopeLabel={activeMajorScopeLabel}
          initialization={initialization}
          backdropProps={backdropProps}
          setImportOpen={setImportOpen}
          setOpenImportGuide={setOpenImportGuide}
          setImportError={setImportError}
          setImportText={setImportText}
          setMajorImportPreview={setMajorImportPreview}
          setMajorImportStep={setMajorImportStep}
          validateMajorImportJson={validateMajorImportJson}
          importJson={importJson}
        />
      )}
      {editing && (
        <TimeRangePickerModal
          open={majorTimeFlowOpen}
          mode="datetime"
          startValue={editing.startTime}
          endValue={editing.endTime}
          subject={editing.name || '分考试'}
          presets={MAJOR_DURATION_PRESETS}
          initialCrossDay={editing.startTime.slice(0, 10) !== editing.endTime.slice(0, 10)}
          anchorRef={majorTimeFlowAnchorRef}
          onPreviewChange={(startTime, endTime) => {
            setEditing((value) => (value ? { ...value, startTime, endTime } : value));
          }}
          onPreviewCancel={(startTime, endTime) => {
            setEditing((value) => (value ? { ...value, startTime, endTime } : value));
          }}
          onCancel={cancelMajorTimeFlow}
          onConfirm={(startTime, endTime) => {
            setLongDurationConfirmed(false);
            setEditing((value) => (value ? { ...value, startTime, endTime } : value));
            setMajorTimeFlowOpen(false);
          }}
        />
      )}
      {can('initialization.run') && (
        <InitializationWizard
          open={wizardOpen}
          onClose={() => setWizardOpen(false)}
          onComplete={completeInitialization}
          onFinalized={finalizeInitialization}
        />
      )}
      {new URLSearchParams(location.search).get('allowIncomplete') === '1' &&
        cloudReadConfirmed &&
        can('initialization.run') &&
        (!initialization.completedAt ||
          !initialization.schoolFullName ||
          grades.length === 0 ||
          classes.length === 0 ||
          recoveryConfigured === false) && (
          <AdminIncompletePrompt
            initialization={initialization}
            grades={grades}
            classes={classes}
            recoveryConfigured={recoveryConfigured}
            onContinue={() => setWizardOpen(true)}
            onOpenClasses={() => setAdminTab('classes')}
          />
        )}
    </div>
  );
}
