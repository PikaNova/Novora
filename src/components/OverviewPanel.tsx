import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  Database,
  MonitorCheck,
  X,
} from "lucide-react";
import type { MajorExam } from "../types";
import type { WeeklyPlan } from "../types/exam";
import type { SchoolClass, SchoolGrade } from "../types/school";
import {
  fetchExamsFromServer,
  type AdminUserContext,
  type ExamPayload,
} from "../services/examService";
import {
  fetchDeviceBindings,
  type DeviceBindingInfo,
} from "../services/classBinding";
import { fetchAuditLogs, type AuditLog } from "../services/adminUsers";
import { getQuickMajorDisplayStatus } from "../utils/majorDisplayStatus";

const ONLINE_MS = 90_000;
type OverviewDetail = "online" | "majors" | "database" | "attention";
const HIGH_RISK_ACTIONS = new Set([
  "database.reset",
  "device.revoke",
  "user.delete",
  "user.password.reset",
  "user.credentials.change",
  "role.delete",
]);

function formatDetailTime(value: number) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function cloudChangeLabel(log: AuditLog) {
  if (log.action === "exam-data.update") return "同步了考试、班级或系统设置改动";
  if (log.action === "database.reset") return "执行了数据重置";
  return log.action;
}

function highRiskLabel(log: AuditLog) {
  const labels: Record<string, string> = {
    "database.reset": "重置了数据库数据",
    "device.revoke": "撤销了设备绑定",
    "user.delete": "删除了管理账户",
    "user.password.reset": "重置了管理账户密码",
    "user.credentials.change": "修改了账户凭据",
    "role.delete": "删除了用户角色",
  };
  return labels[log.action] || log.action;
}

interface Props {
  user: AdminUserContext;
  grades: SchoolGrade[];
  classes: SchoolClass[];
  majors: MajorExam[];
  weeklyPlans: WeeklyPlan[];
  syncLabel: string;
  online: boolean;
  onQuickPublish?: () => void;
}

export default function OverviewPanel({
  user,
  grades,
  classes,
  majors,
  weeklyPlans,
  syncLabel,
  online,
  onQuickPublish,
}: Props) {
  const [devices, setDevices] = useState<DeviceBindingInfo[]>([]);
  const [deviceError, setDeviceError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [detailOpen, setDetailOpen] = useState<OverviewDetail | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState("");
  const [cloudSnapshot, setCloudSnapshot] = useState<ExamPayload | null>(null);
  const liveGrades = cloudSnapshot?.grades ?? grades;
  const liveClasses = cloudSnapshot?.classes ?? classes;
  const liveMajors = cloudSnapshot?.majors ?? majors;
  const liveWeeklyPlans = cloudSnapshot?.weeklyPlans ?? weeklyPlans;
  const scope = useMemo(() => {
    if (
      user.permissions.includes("*") ||
      user.scopes.some((item) => item.type === "all")
    )
      return {
        gradeIds: new Set(liveGrades.map((item) => item.id)),
        classIds: new Set(liveClasses.map((item) => item.id)),
      };
    const gradeIds = new Set(
      user.scopes
        .filter((item) => item.type === "grade")
        .map((item) => item.gradeId),
    );
    const classIds = new Set(
      user.scopes
        .filter((item) => item.type === "class")
        .map((item) => item.classId),
    );
    liveClasses.forEach((item) => {
      if (gradeIds.has(item.gradeId)) classIds.add(item.id);
    });
    return { gradeIds, classIds };
  }, [liveClasses, liveGrades, user.permissions, user.scopes]);

  const loadDevices = useCallback(async () => {
    try {
      const result = await fetchDeviceBindings();
      setDevices(
        result.bindings.filter((item) => scope.classIds.has(item.classId)),
      );
      setDeviceError("");
    } catch (error) {
      setDeviceError(
        error instanceof Error ? error.message : "设备状态读取失败",
      );
    }
  }, [scope]);

  const loadCloudOverview = useCallback(async () => {
    const remote = await fetchExamsFromServer();
    if (remote) setCloudSnapshot(remote);
  }, []);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      if (alive) {
        setNow(Date.now());
        await Promise.all([loadDevices(), loadCloudOverview()]);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [loadCloudOverview, loadDevices]);

  const majorVisibleToScope = (major: MajorExam) => {
    const gradeVisible =
      !major.targetGradeIds?.length ||
      major.targetGradeIds.some((id) => scope.gradeIds.has(id));
    const classVisible =
      !major.targetClassIds?.length ||
      major.targetClassIds.some((id) => scope.classIds.has(id));
    return gradeVisible && classVisible;
  };
  const scopedMajors = liveMajors.filter(majorVisibleToScope);
  const activeMajors = scopedMajors.filter((major) =>
    major.items.some(
      (item) => item.enabled && new Date(item.endTime).getTime() >= now,
    ),
  );
  const scopedPlans = liveWeeklyPlans.filter((plan) =>
    scope.classIds.has(plan.classId),
  );
  const onlineDevices = devices.filter(
    (item) => !item.revoked && now - item.lastSeenAt <= ONLINE_MS,
  );
  const runningDevices = onlineDevices.filter(
    (item) => item.status === "exam-running",
  );
  const majorItems = activeMajors.flatMap((major) =>
    major.items.filter((item) => item.enabled).map((item) => ({ major, item })),
  );
  const majorConflicts = majorItems.flatMap((left, index) =>
    majorItems
      .slice(index + 1)
      .filter((right) => {
        const timeOverlap =
          new Date(left.item.startTime).getTime() <
            new Date(right.item.endTime).getTime() &&
          new Date(left.item.endTime).getTime() >
            new Date(right.item.startTime).getTime();
        const gradeOverlap =
          !left.major.targetGradeIds?.length ||
          !right.major.targetGradeIds?.length ||
          left.major.targetGradeIds.some((id) =>
            right.major.targetGradeIds?.includes(id),
          );
        const classOverlap =
          !left.major.targetClassIds?.length ||
          !right.major.targetClassIds?.length ||
          left.major.targetClassIds.some((id) =>
            right.major.targetClassIds?.includes(id),
          );
        return (
          left.major.id !== right.major.id &&
          timeOverlap &&
          gradeOverlap &&
          classOverlap
        );
      })
      .map((right) => `${left.major.name} / ${right.major.name}`),
  );
  const quickMajorDisplayStatuses: Array<{
    major: MajorExam;
    status: NonNullable<ReturnType<typeof getQuickMajorDisplayStatus>>;
  }> = [];
  scopedMajors.forEach((major) => {
    if (!major.temporary || major.endedAt) return;
    if (!major.items.some((item) => item.enabled && new Date(item.endTime).getTime() >= now)) return;
    const status = getQuickMajorDisplayStatus(major, scopedMajors, now, liveClasses);
    if (status) quickMajorDisplayStatuses.push({ major, status });
  });
  const canReadAudit =
    user.permissions.includes("*") || user.permissions.includes("audit.read");
  const cloudChangeLogs = auditLogs
    .filter(
      (item) =>
        item.action === "exam-data.update" || item.action === "database.reset",
    )
    .slice(0, 12);
  const highRiskLogs = auditLogs
    .filter((item) => HIGH_RISK_ACTIONS.has(item.action))
    .slice(0, 12);
  const activeErrorCount =
    (deviceError ? 1 : 0) +
    (auditError ? 1 : 0) +
    devices.filter((item) => item.revoked).length +
    majorConflicts.length;
  const riskCount = highRiskLogs.length + activeErrorCount;
  const detailTitle =
    detailOpen === "online"
      ? "在线设备"
      : detailOpen === "majors"
        ? "待执行大型考试"
        : detailOpen === "database"
          ? "数据库状态"
          : "最近高风险操作";

  const loadAuditLogs = useCallback(async () => {
    if (!canReadAudit) return;
    setAuditLoading(true);
    setAuditError("");
    try {
      setAuditLogs(await fetchAuditLogs());
    } catch (error) {
      setAuditError(
        error instanceof Error ? error.message : "云端变更记录读取失败",
      );
    } finally {
      setAuditLoading(false);
    }
  }, [canReadAudit]);

  useEffect(() => {
    if (!canReadAudit) return;
    void loadAuditLogs();
    const timer = window.setInterval(() => void loadAuditLogs(), 10_000);
    return () => window.clearInterval(timer);
  }, [canReadAudit, loadAuditLogs]);

  const openDetail = (detail: OverviewDetail) => {
    setDetailOpen(detail);
  };

  return (
    <main className="overview-panel">
      <div className="overview-panel__head">
        <div>
          <span>项目运行情况</span>
          <h2>
            {user.roleId === "super_admin"
              ? "全校运行总览"
              : "管理年级运行总览"}
          </h2>
        </div>
        <div className="overview-panel__actions">
          {onQuickPublish && (
            <button
              className="admin-btn admin-btn--primary"
              onClick={onQuickPublish}
            >
            统一添加单科考试
            </button>
          )}
          <strong className={online ? "is-ok" : "is-warn"}>{syncLabel}</strong>
        </div>
      </div>
      <div className="overview-grid">
        <button
          type="button"
          className="overview-grid__action"
          onClick={() => openDetail("online")}
        >
          <MonitorCheck />
          <span>在线设备</span>
          <strong>{onlineDevices.length}</strong>
          <small>
            共 {devices.length} 台 · {runningDevices.length} 台考试中
          </small>
        </button>
        <button
          type="button"
          className="overview-grid__action"
          onClick={() => openDetail("majors")}
        >
          <CalendarClock />
          <span>待执行大型考试</span>
          <strong>{activeMajors.length}</strong>
          <small>
            {scopedPlans.filter((item) => item.enabled).length} 个启用周测计划
          </small>
        </button>
        <button
          type="button"
          className="overview-grid__action"
          onClick={() => openDetail("database")}
        >
          <Database />
          <span>数据库状态</span>
          <strong>{deviceError ? "连接异常" : "连接正常"}</strong>
          <small>
            {scope.gradeIds.size} 个年级 · {scope.classIds.size} 个班级
          </small>
        </button>
        <button
          type="button"
          className="overview-grid__action"
          onClick={() => openDetail("attention")}
        >
          <AlertTriangle />
          <span>最近高风险操作</span>
          <strong>{riskCount}</strong>
          <small>
            {activeErrorCount
              ? "存在同步、设备或排期异常"
              : highRiskLogs.length
                ? `${highRiskLogs.length} 条近期操作记录`
                : "暂无高风险操作"}
          </small>
        </button>
      </div>
      <section className="overview-section">
        <h3>正在进行</h3>
        {runningDevices.length ? (
          <div className="overview-running">
            {runningDevices.map((item) => (
              <div key={item.instanceId}>
                <strong>{item.currentSubject || "考试"}</strong>
                <span>
                  {item.currentExam || "当前考试"} ·{" "}
                  {liveClasses.find((value) => value.id === item.classId)?.name ||
                    "未识别班级"}
                </span>
                <code>{item.instanceId}</code>
              </div>
            ))}
          </div>
        ) : (
          <p>当前管理范围内没有正在考试的设备。</p>
        )}
      </section>
      {quickMajorDisplayStatuses.length > 0 && (
        <section className="overview-section">
          <h3>临时统一考试显示状态</h3>
          <div className="overview-running overview-running--display-status">
            {quickMajorDisplayStatuses.map(({ major, status }) => (
              <div
                key={major.id}
                className={`overview-display-status is-${status.tone}`}
              >
                <strong>{major.name}</strong>
                <span>{status.label}</span>
                <small>{status.detail}</small>
              </div>
            ))}
          </div>
        </section>
      )}
      {majorConflicts.length > 0 && (
        <section className="overview-section">
          <h3>大型考试冲突</h3>
          <div className="overview-running">
            {[...new Set(majorConflicts)].map((label) => (
              <div key={label}>
                <strong>{label}</strong>
                <span>适用范围和考试时间存在重叠，请在大型考试模块核对。</span>
              </div>
            ))}
          </div>
        </section>
      )}
      {detailOpen && (
        <div
          className="overview-device-drawer"
          role="dialog"
          aria-modal="true"
          aria-label={detailTitle}
        >
          <button
            className="overview-device-drawer__backdrop"
            aria-label="关闭"
            onClick={() => setDetailOpen(null)}
          />
          <aside>
            <header>
              <div>
                <span>当前授权范围</span>
                <h3>{detailTitle}</h3>
              </div>
              <button
                className="admin-btn"
                onClick={() => setDetailOpen(null)}
                aria-label="关闭"
              >
                <X size={17} />
              </button>
            </header>
            <div className="overview-device-drawer__list">
              {detailOpen === "online" && (onlineDevices.length ? (
                onlineDevices.map((device) => (
                  <article key={device.instanceId}>
                    <strong>
                      {liveClasses.find((item) => item.id === device.classId)
                        ?.name || "未绑定班级"}
                    </strong>
                    <span>
                      {device.status === "exam-running"
                        ? `${device.currentExam} · ${device.currentSubject}`
                        : "在线待命"}
                    </span>
                    <code title={device.instanceId}>{device.instanceId}</code>
                    <small>
                      最近心跳：
                      {new Date(device.lastSeenAt).toLocaleString("zh-CN", {
                        hour12: false,
                      })}
                    </small>
                  </article>
                ))
              ) : (
                <p>暂无在线设备。</p>
              ))}
              {detailOpen === "majors" && (activeMajors.length ? (
                activeMajors.map((major) => {
                  const enabledItems = major.items.filter((item) => item.enabled);
                  const nextItem = enabledItems
                    .filter((item) => new Date(item.endTime).getTime() >= now)
                    .sort((left, right) => new Date(left.startTime).getTime() - new Date(right.startTime).getTime())[0];
                  return (
                    <article key={major.id}>
                      <strong>{major.name}</strong>
                      <span>{enabledItems.length} 个启用科目 {nextItem ? `· 下一场 ${nextItem.name}` : "· 全部已结束"}</span>
                      <small>{nextItem ? `开始时间：${formatDetailTime(new Date(nextItem.startTime).getTime())}` : "请在大型考试模块查看完整安排"}</small>
                    </article>
                  );
                })
              ) : (
                <p>当前授权范围内暂无待执行的大型考试。</p>
              ))}
              {detailOpen === "database" && (
                <>
                  <article>
                    <strong>{deviceError ? "连接异常" : "连接正常"}</strong>
                    <span>{syncLabel}</span>
                    <small>{scope.gradeIds.size} 个年级 · {scope.classIds.size} 个班级</small>
                  </article>
                  {canReadAudit ? (
                    auditLoading ? <p>正在读取最近同步到云端的改动…</p> : auditError ? <p>{auditError}</p> : cloudChangeLogs.length ? cloudChangeLogs.map((log) => (
                      <article key={log.id}>
                        <strong>{cloudChangeLabel(log)}</strong>
                        <span>{log.username || "系统"} · {formatDetailTime(log.createdAt)}</span>
                        <small>{log.detail && typeof log.detail === "object" ? JSON.stringify(log.detail) : "云端数据已更新"}</small>
                      </article>
                    )) : <p>暂未找到考试、班级或设置的云端改动记录。</p>
                  ) : (
                    <p>当前账户无权查看云端改动记录。</p>
                  )}
                </>
              )}
              {detailOpen === "attention" && (
                riskCount || auditLoading ? (
                  <>
                    {(deviceError || auditError || devices.some((item) => item.revoked) || majorConflicts.length > 0) && (
                      <div className="overview-device-drawer__group">
                        <strong>错误提醒</strong>
                        {deviceError && <article><strong>同步或设备状态读取异常</strong><span>{deviceError}</span></article>}
                        {auditError && <article><strong>云端审计日志读取异常</strong><span>{auditError}</span></article>}
                        {devices.filter((item) => item.revoked).map((device) => (
                          <article key={device.instanceId}><strong>设备已被撤销</strong><span>{device.instanceId}</span><small>该设备需要重新绑定后才能继续同步。</small></article>
                        ))}
                        {[...new Set(majorConflicts)].map((label) => (
                          <article key={label}><strong>大型考试时间冲突</strong><span>{label}</span><small>请核对考试时间与适用范围。</small></article>
                        ))}
                      </div>
                    )}
                    <div className="overview-device-drawer__group">
                      <strong>近期高风险操作</strong>
                      {auditLoading && !highRiskLogs.length ? <p>正在读取云端操作记录…</p> : highRiskLogs.length ? highRiskLogs.map((log) => (
                        <article key={log.id}>
                          <strong>{highRiskLabel(log)}</strong>
                          <span>{log.username || "系统"} · {formatDetailTime(log.createdAt)}</span>
                          <small>{log.detail && typeof log.detail === "object" ? JSON.stringify(log.detail) : log.resourceId || log.resourceType}</small>
                        </article>
                      )) : <p>暂无近期高风险操作。</p>}
                    </div>
                  </>
                ) : (
                  <p>当前没有错误提醒或高风险操作。</p>
                )
              )}
            </div>
            <footer>
              {detailOpen === "online" || detailOpen === "attention" ? (
                <a className="admin-btn" href="/admin?tab=devices">进入设备管理</a>
              ) : detailOpen === "majors" ? (
                <a className="admin-btn" href="/admin?tab=major">进入大型考试</a>
              ) : null}
            </footer>
          </aside>
        </div>
      )}
    </main>
  );
}
