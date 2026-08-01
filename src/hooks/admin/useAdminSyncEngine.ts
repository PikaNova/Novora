import { useEffect } from "react";
import type { MutableRefObject } from "react";
import type { NavigateFunction, Location } from "react-router-dom";
import {
  adminCan,
  fetchExamsFromServer,
  getAdminRecoveryStatus,
  hasValidLocalToken,
  isLoginRequired,
  refreshAdminUser,
  type AdminUserContext,
} from "../../services/examService";
import { getAppSettings, updateExamSettings, updateAlertsSettings } from "../../utils/appSettings";
import { getPendingExamSync } from "../../services/examOutbox";
import type { AlertsSettings, MajorExam } from "../../types";
import type { AdminTab } from "../../types/exam";
import type { WeeklyState } from "./useWeeklyScheduleSync";
import type { SyncState } from "./adminPageUtils";
import { syncMajorStateRef } from "./adminPageUtils";

export const OPEN_ADMIN: AdminUserContext = {
  id: 0,
  username: "local-admin",
  displayName: "本地管理员",
  roleId: "super_admin",
  roleName: "超级管理员",
  permissions: ["*"],
  scopes: [{ type: "all", gradeId: "", classId: "" }],
  mustChangePassword: false,
};

// Owns cloud-connectivity/sync status (`sync`/`online`/`cloudReadConfirmed`/
// `recoveryConfigured`), the URL-parameter-driven modal openers, the boot-time
// auth + cloud reconciliation flow, and the online/offline flush effect.
// Because boot-time reconciliation can overwrite almost every domain's state
// with a freshly fetched remote snapshot, this hook needs each domain's
// setters passed in directly; it is initialized last so every other domain
// hook already exists.
export function useAdminSyncEngine(params: {
  navigate: NavigateFunction;
  location: Pick<Location, "search">;
  adminUser: AdminUserContext | null;
  setAdminUser: (user: AdminUserContext | null) => void;
  setReady: (ready: boolean) => void;
  setSync: (state: SyncState) => void;
  setOnline: (online: boolean) => void;
  cloudReadConfirmed: boolean;
  setCloudReadConfirmed: (confirmed: boolean) => void;
  setRecoveryConfigured: (configured: boolean | null) => void;
  pendingRef: MutableRefObject<boolean>;
  stateRef: MutableRefObject<{ majors: MajorExam[]; activeMajorId: string }>;
  weeklyStateRef: MutableRefObject<WeeklyState>;
  initializationCompletedAt: number | undefined;
  gradesLength: number;
  classesLength: number;
  adminTab: AdminTab;
  setAdminTab: (tab: AdminTab) => void;
  setAlertsOpen: (open: boolean) => void;
  setDeniedModule: (label: string) => void;
  setAnnounceOpen: (open: boolean) => void;
  setWizardOpen: (open: boolean) => void;
  setAlerts: (alerts: AlertsSettings) => void;
  setInitialization: (value: unknown) => void;
  pushToServer: (
    ms: MajorExam[],
    activeId: string,
    syncLabel?: string,
  ) => Promise<void>;
  pushWeeklyToServer: (
    weekly: WeeklyState,
    syncLabel?: string,
  ) => Promise<void>;
  setMajors: (ms: MajorExam[]) => void;
  setActiveMajorId: (id: string) => void;
  setEditingMajorId: (updater: (current: string) => string) => void;
  setScheduleMode: (mode: WeeklyState["scheduleMode"]) => void;
  setWeeklyPlans: (plans: WeeklyState["weeklyPlans"]) => void;
  setActiveWeeklyPlanId: (id: WeeklyState["activeWeeklyPlanId"]) => void;
  setActiveWeeklyPlanIdByClassId: (
    value: WeeklyState["activeWeeklyPlanIdByClassId"],
  ) => void;
  setGrades: (grades: WeeklyState["grades"]) => void;
  setClasses: (classes: WeeklyState["classes"]) => void;
  setSelectedGradeId: (id: string) => void;
  setSelectedClassId: (id: string) => void;
  setWeeklyConflictPolicy: (policy: WeeklyState["weeklyConflictPolicy"]) => void;
}) {
  const {
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
    initializationCompletedAt,
    gradesLength,
    classesLength,
    adminTab,
    setAdminTab,
    setAlertsOpen,
    setDeniedModule,
    setAnnounceOpen,
    setWizardOpen,
    setAlerts,
    setInitialization,
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
  } = params;

  // 从设置页「前往提醒管理」直达：URL 带 ?alerts=1 时自动打开提醒管理弹窗
  useEffect(() => {
    const search = new URLSearchParams(location.search);
    const requestedTab = search.get("tab") as AdminTab | null;
    const ADMIN_NAV_PERMISSION: Record<AdminTab, string> = {
      overview: "overview.read",
      major: "major.read",
      weekly: "weekly.read",
      classes: "school.read",
      devices: "device.read",
      users: "user.read",
    };
    const ADMIN_NAV_LABEL: Record<AdminTab, string> = {
      overview: "运行总览",
      major: "大型考试",
      weekly: "周测计划",
      classes: "年级与班级",
      devices: "设备管理",
      users: "用户与权限",
    };
    if (requestedTab && ADMIN_NAV_PERMISSION[requestedTab]) {
      if (
        requestedTab === "users" ||
        adminCan(ADMIN_NAV_PERMISSION[requestedTab], adminUser)
      ) {
        setAdminTab(requestedTab);
        setDeniedModule("");
      } else setDeniedModule(ADMIN_NAV_LABEL[requestedTab]);
    }
    if (search.get("alerts") === "1" && adminCan("alerts.read", adminUser))
      setAlertsOpen(true);
    if (search.get("announce") === "1") setAnnounceOpen(true);
    const setupRequired =
      !initializationCompletedAt || gradesLength === 0 || classesLength === 0;
    const allowIncomplete = search.get("allowIncomplete") === "1";
    if (
      search.get("initialize") === "1" &&
      !allowIncomplete &&
      cloudReadConfirmed &&
      setupRequired &&
      adminCan("initialization.run", adminUser)
    )
      setWizardOpen(true);
    if (
      allowIncomplete &&
      cloudReadConfirmed &&
      adminCan("initialization.run", adminUser)
    )
      void getAdminRecoveryStatus()
        .then(setRecoveryConfigured)
        .catch(() => setRecoveryConfigured(null));
  }, [
    adminUser,
    location.search,
    cloudReadConfirmed,
    initializationCompletedAt,
    gradesLength,
    classesLength,
  ]);

  // 开机：鉴权 + 拉取服务器数据
  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      const hasToken = hasValidLocalToken();
      const requiredP = hasToken ? Promise.resolve(true) : isLoginRequired();
      const remoteP = fetchExamsFromServer();
      const userP = hasToken ? refreshAdminUser() : Promise.resolve(null);

      const required = await requiredP;
      if (cancelled) return;
      if (required && !hasValidLocalToken()) {
        navigate("/login?next=/admin", { replace: true });
        return;
      }
      const verifiedUser = await userP;
      if (cancelled) return;
      if (required && !verifiedUser) {
        navigate("/login?next=/admin", { replace: true });
        return;
      }
      if (verifiedUser?.mustChangePassword) {
        setAdminUser(verifiedUser);
        setAdminTab("users");
        setReady(true);
        if (location.search !== "?tab=users&password=1")
          navigate("/admin?tab=users&password=1", { replace: true });
        return;
      }
      setAdminUser(verifiedUser ?? OPEN_ADMIN);
      setReady(true);

      const remote = await remoteP;
      if (cancelled) return;
      if (remote) setCloudReadConfirmed(true);
      const localAt = getAppSettings().exam?.updatedAt ?? 0;
      const pendingSync = getPendingExamSync();

      if (
        remote &&
        (remote.updatedAt > localAt ||
          (remote.updatedAt === localAt && !pendingSync) ||
          (remote.updatedAt < localAt && !pendingSync))
      ) {
        const remoteUpdates: Record<string, unknown> = {
          items: remote.items,
          title: remote.title,
          majors: remote.majors && remote.majors.length ? remote.majors : undefined,
          activeMajorId: remote.activeMajorId || undefined,
          updatedAt: remote.updatedAt,
        };
        if (remote.scheduleMode !== undefined) remoteUpdates.scheduleMode = remote.scheduleMode;
        if (remote.weeklyPlans !== undefined) remoteUpdates.weeklyPlans = remote.weeklyPlans;
        if (remote.activeWeeklyPlanId !== undefined)
          remoteUpdates.activeWeeklyPlanId = remote.activeWeeklyPlanId;
        if (remote.activeWeeklyPlanIdByClassId !== undefined)
          remoteUpdates.activeWeeklyPlanIdByClassId = remote.activeWeeklyPlanIdByClassId;
        if (remote.grades !== undefined) remoteUpdates.grades = remote.grades;
        if (remote.classes !== undefined) remoteUpdates.classes = remote.classes;
        if (remote.initialization !== undefined) remoteUpdates.initialization = remote.initialization;
        if (remote.weeklyConflictPolicy !== undefined)
          remoteUpdates.weeklyConflictPolicy = remote.weeklyConflictPolicy;
        updateExamSettings(remoteUpdates as never);
        if (remote.alerts) {
          updateAlertsSettings(remote.alerts as never);
          setAlerts(getAppSettings().alerts);
        }
        const merged = getAppSettings().exam;
        syncMajorStateRef(stateRef, merged.majors, merged.activeMajorId);
        setMajors(merged.majors);
        setActiveMajorId(merged.activeMajorId);
        setEditingMajorId((current) =>
          merged.majors.some((item) => item.id === current) ? current : merged.activeMajorId,
        );
        setScheduleMode(merged.scheduleMode);
        setWeeklyPlans(merged.weeklyPlans);
        setActiveWeeklyPlanId(merged.activeWeeklyPlanId);
        setActiveWeeklyPlanIdByClassId(merged.activeWeeklyPlanIdByClassId);
        setGrades(merged.grades);
        setClasses(merged.classes);
        setSelectedGradeId(merged.selectedGradeId);
        setSelectedClassId(merged.selectedClassId);
        setWeeklyConflictPolicy(merged.weeklyConflictPolicy);
        setInitialization(merged.initialization);
        pendingRef.current = false;
        setSync("saved");
      } else if (pendingSync && localAt > (remote?.updatedAt ?? 0)) {
        pendingRef.current = true;
        const localExam = getAppSettings().exam;
        void pushToServer(localExam.majors, localExam.activeMajorId);
        void pushWeeklyToServer({
          scheduleMode: localExam.scheduleMode,
          weeklyPlans: localExam.weeklyPlans,
          activeWeeklyPlanId: localExam.activeWeeklyPlanId,
          activeWeeklyPlanIdByClassId: localExam.activeWeeklyPlanIdByClassId,
          grades: localExam.grades,
          classes: localExam.classes,
          weeklyConflictPolicy: localExam.weeklyConflictPolicy,
        });
      } else {
        setSync(remote ? "saved" : "offline");
      }
    };
    void boot();
    return () => {
      cancelled = true;
    };
  }, [location.search, navigate, pushToServer, pushWeeklyToServer]);

  // 网络状态：回线时自动回推未同步变更
  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      if (pendingRef.current) {
        void pushToServer(stateRef.current.majors, stateRef.current.activeMajorId);
        void pushWeeklyToServer(weeklyStateRef.current);
      }
    };
    const goOffline = () => {
      setOnline(false);
      setSync("offline");
    };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [pushToServer, pushWeeklyToServer]);
}
