import React, { useCallback, useEffect, useMemo, useState } from "react";
import HelpTip from "./HelpTip";
import {
  fetchDeviceBindings,
  revokeDevice,
  sendDeviceCommand,
  getClassBindingInstanceId,
  type DeviceBindingInfo,
  type DeviceCommand,
  type PluginBindingInfo,
} from "../services/classBinding";
import { getAppSettings } from "../utils/appSettings";
import { classDisplayName } from "../utils/classSettings";
import { notify } from "../services/notify";
import { confirmDialog } from "../services/appDialog";
import ClassMultiPicker, { type ClassPickerOption } from "./ClassMultiPicker";
import InlineSelect from "./InlineSelect";
import DesignPolicyManager from "./DesignPolicyManager";
import { getAdminUser } from "../services/examService";

const ONLINE_MS = 90_000;
const formatTime = (value: number) =>
  value > 0
    ? new Date(value).toLocaleString("zh-CN", { hour12: false })
    : "从未上线";
const statusLabel = (item?: DeviceBindingInfo) =>
  !item
    ? "仅连接 ClassIsland"
    : item.status === "exam-running"
      ? "考试进行中"
      : item.status === "waiting"
        ? "等待考试"
        : item.status === "temporary-paused"
          ? "临时考试已暂停"
          : "空闲";

type DeviceGroup = {
  key: string;
  instanceId: string;
  gradeId: string;
  classId: string;
  dashboard?: DeviceBindingInfo;
  plugins: PluginBindingInfo[];
};

export default function DeviceStatusPanel({
  canRevoke = true,
  canEditDesign = false,
}: {
  canRevoke?: boolean;
  canEditDesign?: boolean;
}) {
  const [bindings, setBindings] = useState<DeviceBindingInfo[]>([]);
  const [plugins, setPlugins] = useState<PluginBindingInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [gradeFilter, setGradeFilter] = useState("*");
  const [classFilters, setClassFilters] = useState<string[]>([]);
  const [deviceCategory, setDeviceCategory] = useState<"active" | "removed">(
    "active",
  );
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [now, setNow] = useState(Date.now());
  const { grades, classes } = getAppSettings().exam;
  const currentInstanceId = getClassBindingInstanceId();
  const currentAdmin = getAdminUser();
  const currentAdminScope = useMemo(() => {
    if (!currentAdmin) return "管理范围未记录";
    if (currentAdmin.scopes.some((scope) => scope.type === "all")) return "全校";
    const names = currentAdmin.scopes.map((scope) => scope.type === "grade"
      ? grades.find((grade) => grade.id === scope.gradeId)?.name
      : classDisplayName(grades, classes, scope.classId));
    return names.filter(Boolean).join("、") || "未分配范围";
  }, [classes, currentAdmin, grades]);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const result = await fetchDeviceBindings();
      setBindings(result.bindings);
      setPlugins(result.plugins);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "设备管理加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void load(true);
    }, 10_000);
    return () => clearInterval(timer);
  }, [load]);

  const groups = useMemo(() => {
    const attached = new Set<string>();
    const result: DeviceGroup[] = bindings.map((dashboard) => {
      const linked = plugins.filter(
        (plugin) => plugin.viewerInstanceId === dashboard.instanceId,
      );
      linked.forEach((plugin) => attached.add(plugin.pluginInstanceId));
      return {
        key: `viewer:${dashboard.instanceId}`,
        instanceId: dashboard.instanceId,
        gradeId: dashboard.gradeId || linked[0]?.gradeId || "",
        classId: dashboard.classId || linked[0]?.classId || "",
        dashboard,
        plugins: linked,
      };
    });
    plugins
      .filter((plugin) => !attached.has(plugin.pluginInstanceId))
      .forEach((plugin) =>
        result.push({
          key: `plugin:${plugin.pluginInstanceId}`,
          instanceId: plugin.viewerInstanceId,
          gradeId: plugin.gradeId,
          classId: plugin.classId,
          plugins: [plugin],
        }),
      );
    return result;
  }, [bindings, plugins]);

  const visibleClasses = classes.filter(
    (item) => gradeFilter === "*" || item.gradeId === gradeFilter,
  );
  const pickerOptions = useMemo<ClassPickerOption[]>(
    () =>
      visibleClasses.map((item) => ({
        id: item.id,
        gradeId: item.gradeId,
        gradeName:
          grades.find((grade) => grade.id === item.gradeId)?.name ?? "未知年级",
        className: item.name,
      })),
    [grades, visibleClasses],
  );
  const filtered = useMemo(
    () =>
      groups.filter((item) => {
        const name = classDisplayName(grades, classes, item.classId);
        const text = query.trim().toLowerCase();
        const pluginIds = item.plugins
          .map((plugin) => plugin.pluginInstanceId)
          .join(" ");
        const dashboard = item.dashboard;
        return (
          (gradeFilter === "*" || item.gradeId === gradeFilter) &&
          (!classFilters.length || classFilters.includes(item.classId)) &&
          (!text ||
            `${item.instanceId} ${pluginIds} ${name} ${dashboard?.currentExam || ""} ${dashboard?.currentSubject || ""}`
              .toLowerCase()
              .includes(text))
        );
      }),
    [classFilters, classes, gradeFilter, grades, groups, query],
  );

  const isRemovedGroup = (item: DeviceGroup) =>
    item.dashboard?.revoked === true &&
    item.plugins.every((plugin) => !plugin.paired);
  const activeFiltered = useMemo(
    () => filtered.filter((item) => !isRemovedGroup(item)),
    [filtered],
  );
  const removedFiltered = useMemo(
    () => filtered.filter(isRemovedGroup),
    [filtered],
  );
  const categoryFiltered =
    deviceCategory === "removed" ? removedFiltered : activeFiltered;

  const dashboardOnline = (item: DeviceGroup) =>
    !!item.dashboard &&
    !item.dashboard.revoked &&
    now - item.dashboard.lastSeenAt <= ONLINE_MS;
  const pluginOnline = (plugin: PluginBindingInfo) =>
    plugin.paired && now - plugin.pluginLastSeenAt <= ONLINE_MS;
  const viewerOnline = (plugin: PluginBindingInfo) =>
    plugin.paired && now - plugin.viewerLastSeenAt <= ONLINE_MS;
  const groupOnline = (item: DeviceGroup) =>
    dashboardOnline(item) ||
    item.plugins.some((plugin) => pluginOnline(plugin) || viewerOnline(plugin));
  const groupLastSeenAt = (item: DeviceGroup) =>
    Math.max(
      item.dashboard?.lastSeenAt || 0,
      ...item.plugins.flatMap((plugin) => [
        plugin.pluginLastSeenAt,
        plugin.viewerLastSeenAt,
      ]),
    );
  const orderedFiltered = useMemo(
    () =>
      [...categoryFiltered].sort((a, b) => {
        const aCurrent = a.instanceId === currentInstanceId;
        const bCurrent = b.instanceId === currentInstanceId;
        if (aCurrent !== bCurrent) return aCurrent ? -1 : 1;
        const aOnline = groupOnline(a);
        const bOnline = groupOnline(b);
        if (aOnline !== bOnline) return aOnline ? -1 : 1;
        const recentFirst = groupLastSeenAt(b) - groupLastSeenAt(a);
        if (recentFirst !== 0) return recentFirst;
        return (a.instanceId || a.key).localeCompare(b.instanceId || b.key, "zh-CN");
      }),
    [categoryFiltered, currentInstanceId, now],
  );
  const onlineCount = groups.filter(groupOnline).length;

  const remove = async (item: DeviceGroup) => {
    const label =
      item.instanceId || item.plugins[0]?.pluginInstanceId || item.key;
    if (
      !(await confirmDialog({
        title: "删除设备",
        message: `确定删除设备 ${label}？\nNovora 看板与关联 ClassIsland 插件都会解除绑定。`,
        tone: "danger",
        confirmLabel: "删除设备",
      }))
    )
      return;
    try {
      await revokeDevice(
        item.dashboard?.instanceId || "",
        item.plugins.map((plugin) => plugin.pluginInstanceId),
      );
      await load(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除设备失败");
    }
  };
  const removeSelected = async () => {
    const targets = groups.filter((item) => selectedKeys.includes(item.key));
    if (
      !targets.length ||
      !(await confirmDialog({
        title: `删除 ${targets.length} 台设备`,
        message:
          "所有关联看板和 ClassIsland 插件都会解除绑定，并需要重新绑定。",
        tone: "danger",
        confirmLabel: "批量删除",
      }))
    )
      return;
    const results = await Promise.allSettled(
      targets.map((item) =>
        revokeDevice(
          item.dashboard?.instanceId || "",
          item.plugins.map((plugin) => plugin.pluginInstanceId),
        ),
      ),
    );
    const failed = targets.filter(
      (_, index) => results[index].status === "rejected",
    );
    setSelectedKeys(failed.map((item) => item.key));
    await load(true);
    if (!failed.length) {
      setError("");
      notify("success", `已删除 ${targets.length} 台设备。`);
    } else if (failed.length < targets.length) {
      setError(
        `${targets.length - failed.length} 台设备已删除，${failed.length} 台删除失败并保持选中，请重试。`,
      );
      notify("warning", "部分设备删除失败，列表已按实际结果刷新。");
    } else {
      const firstFailure = results.find(
        (result) => result.status === "rejected",
      );
      setError(
        firstFailure?.status === "rejected" &&
          firstFailure.reason instanceof Error
          ? firstFailure.reason.message
          : "批量删除设备失败",
      );
    }
  };

  const command = async (
    item: DeviceBindingInfo,
    action: DeviceCommand["action"],
  ) => {
    try {
      await sendDeviceCommand(
        item.instanceId,
        action,
        action === "extend" ? 5 : undefined,
      );
      notify(
        "success",
        `已发送${action === "pause" ? "暂停" : action === "resume" ? "继续" : action === "extend" ? "延长 5 分钟" : "结束"}指令。`,
      );
    } catch (cause) {
      notify(
        "error",
        cause instanceof Error ? cause.message : "临时考试指令发送失败",
      );
    }
  };

  return (
    <main className="device-status">
      <div className="device-status__heading">
        <div>
          <h2>
            设备管理{" "}
            <HelpTip title="看板与 ClassIsland">
              同一台设备上的 Novora 看板和 ClassIsland
              插件按实例关联后合并展示。在线状态分别由各自心跳判断；删除会让两端重新绑定。
            </HelpTip>
          </h2>
          <p>
            一个设备视图同时显示 Novora 看板、ClassIsland
            插件、当前考试和班级绑定。
          </p>
        </div>
        <button
          className="admin-btn"
          onClick={() => void load()}
          disabled={loading}
        >
          刷新
        </button>
      </div>
      <DesignPolicyManager grades={grades} classes={classes} devices={bindings} canEdit={canEditDesign} />
      <div className="device-status__stats">
        <div>
          <span>设备总数</span>
          <strong>{groups.length}</strong>
        </div>
        <div>
          <span>任一端在线</span>
          <strong>{onlineCount}</strong>
        </div>
        <div>
          <span>考试进行中</span>
          <strong>
            {
              groups.filter(
                (item) =>
                  dashboardOnline(item) &&
                  item.dashboard?.status === "exam-running",
              ).length
            }
          </strong>
        </div>
        <div>
          <span>ClassIsland 已配对</span>
          <strong>{plugins.filter((item) => item.paired).length}</strong>
        </div>
      </div>
      <div className="device-status__toolbar">
        <label>
          <span>搜索</span>
          <input
            className="admin-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="看板实例、插件实例、班级或考试"
          />
        </label>
        <label>
          <span>年级</span>
          <InlineSelect
            className="admin-input"
            value={gradeFilter}
            onChange={(value) => {
              setGradeFilter(value);
              setClassFilters([]);
            }}
            options={[
              { value: "*", label: "全部年级" },
              ...grades.map((item) => ({ value: item.id, label: item.name })),
            ]}
          />
        </label>
        <details className="device-status__class-filter">
          <summary>
            班级筛选
            {classFilters.length ? ` · ${classFilters.length} 个` : " · 全部"}
          </summary>
          <ClassMultiPicker
            options={pickerOptions}
            selectedIds={classFilters}
            onChange={setClassFilters}
            showSearch={false}
            selectionSummary={
              classFilters.length
                ? `已筛选 ${classFilters.length} 个班级`
                : "当前显示全部班级"
            }
          />
        </details>
      </div>
      <div className="device-status__categories" role="tablist" aria-label="设备分类">
        <button
          type="button"
          role="tab"
          aria-selected={deviceCategory === "active"}
          className={deviceCategory === "active" ? "is-active" : ""}
          onClick={() => setDeviceCategory("active")}
        >
          有效设备 <span>{activeFiltered.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={deviceCategory === "removed"}
          className={deviceCategory === "removed" ? "is-active" : ""}
          onClick={() => setDeviceCategory("removed")}
        >
          已删除设备 <span>{removedFiltered.length}</span>
        </button>
      </div>
      {canRevoke && deviceCategory === "active" && (
        <div className="device-status__batch">
          <label>
            <input
              type="checkbox"
              checked={
                activeFiltered.length > 0 &&
                activeFiltered.every((item) => selectedKeys.includes(item.key))
              }
              onChange={(event) =>
                setSelectedKeys(
                  event.target.checked
                    ? [
                        ...new Set([
                          ...selectedKeys,
                          ...activeFiltered.map((item) => item.key),
                        ]),
                      ]
                    : selectedKeys.filter(
                        (key) => !activeFiltered.some((item) => item.key === key),
                      ),
                )
              }
            />
            选择当前结果
          </label>
          <span>已选择 {selectedKeys.length} 台设备</span>
          <button
            className="admin-btn admin-btn--danger"
            disabled={!selectedKeys.length}
            onClick={() => void removeSelected()}
          >
            批量删除
          </button>
        </div>
      )}
      {error && <div className="admin-error">{error}</div>}
      {loading && (
        <div className="device-status__loading">正在读取设备状态…</div>
      )}
      {!loading && categoryFiltered.length === 0 && (
        <div className="admin-empty">
          <p>{deviceCategory === "removed" ? "暂无已删除设备" : "暂无符合条件的有效设备"}</p>
        </div>
      )}
      {categoryFiltered.length > 0 && (
        <div className="device-status__table">
          <div className="device-status__table-head">
            <span>设备与班级</span>
            <span>实时状态</span>
            <span>最近在线</span>
            <span>操作</span>
          </div>
          <div className="device-status__list">
            {orderedFiltered.map((item) => {
              const dashboard = item.dashboard;
              const temporary =
                !!dashboard &&
                (dashboard.currentExam.includes("临时考试") ||
                  dashboard.status === "temporary-paused");
              const lastSeenAt = groupLastSeenAt(item);
              const removed = isRemovedGroup(item);
              const isDashboardOnline = dashboardOnline(item);
              const isCurrentDevice = item.instanceId === currentInstanceId;
              const managementRoleName = dashboard?.managementRoleName || (isCurrentDevice ? currentAdmin?.roleName : "") || "";
              const managementTitle = dashboard?.isManagement
                ? managementRoleName ? `${managementRoleName} · 管理设备` : "管理设备"
                : "";
              return (
                <div
                  className={`device-status__row${removed ? " is-revoked" : ""}${isCurrentDevice ? " is-current" : ""}`}
                  key={item.key}
                >
                  <div className={`device-status__instance${canRevoke && !removed ? " is-selectable" : ""}`}>
                    {canRevoke && !removed && (
                      <input
                        type="checkbox"
                        checked={selectedKeys.includes(item.key)}
                        onChange={(event) =>
                          setSelectedKeys((value) =>
                            event.target.checked
                              ? [...value, item.key]
                              : value.filter((key) => key !== item.key),
                          )
                        }
                        aria-label={`选择设备 ${item.instanceId}`}
                      />
                    )}
                    <strong className={item.classId || dashboard?.isManagement ? "" : "is-unbound"}>
                      {dashboard?.isManagement
                        ? managementTitle
                        : item.classId
                        ? classDisplayName(grades, classes, item.classId)
                        : "未绑定班级"}
                      {isCurrentDevice && <em className="device-status__current-badge">当前设备</em>}
                    </strong>
                    {dashboard?.isManagement && <small className="device-status__management-scope">{dashboard.managementScopeLabel || (isCurrentDevice ? currentAdminScope : "管理范围未记录")}</small>}
                    {dashboard ? (
                      <code title={dashboard.instanceId}>
                        看板 {dashboard.instanceId}
                      </code>
                    ) : (
                      <code>尚无独立看板心跳</code>
                    )}
                    {item.plugins.map((plugin) => (
                      <code
                        title={plugin.pluginInstanceId}
                        key={plugin.pluginInstanceId}
                      >
                        ClassIsland {plugin.pluginInstanceId}
                      </code>
                    ))}
                  </div>
                  <div className="device-status__class">
                    <strong>
                      {removed
                        ? "已删除，等待重新绑定"
                        : isDashboardOnline
                          ? statusLabel(dashboard)
                          : "设备离线"}
                    </strong>
                    <div className="device-status__channels">
                      <span
                        className={
                          isDashboardOnline ? "is-online" : "is-offline"
                        }
                      >
                        Novora 看板 {isDashboardOnline ? "在线" : "离线"}
                      </span>
                      {item.plugins.map((plugin) => (
                        <span
                          key={plugin.pluginInstanceId}
                          className={
                            pluginOnline(plugin)
                              ? "is-online"
                              : plugin.paired
                                ? "is-offline"
                                : "is-removed"
                          }
                        >
                          ClassIsland{" "}
                          {pluginOnline(plugin)
                            ? "在线"
                            : plugin.paired
                              ? "离线"
                              : "未绑定"}
                        </span>
                      ))}
                    </div>
                    <span>
                      {isDashboardOnline && dashboard?.currentSubject
                        ? `${dashboard.currentExam} · ${dashboard.currentSubject}`
                        : dashboard
                          ? `页面 ${dashboard.page || "未知"} · v${dashboard.clientVersion || "未知"}`
                          : "插件已接入，等待 Novora 看板客户端心跳"}
                    </span>
                    {isDashboardOnline && temporary && canRevoke && (
                      <div className="device-status__commands">
                        <button
                          onClick={() =>
                            void command(
                              dashboard,
                              dashboard.status === "temporary-paused"
                                ? "resume"
                                : "pause",
                            )
                          }
                        >
                          {dashboard.status === "temporary-paused"
                            ? "继续"
                            : "暂停"}
                        </button>
                        <button
                          onClick={() => void command(dashboard, "extend")}
                        >
                          +5 分钟
                        </button>
                        <button
                          className="is-danger"
                          onClick={() => void command(dashboard, "end")}
                        >
                          结束
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="device-status__updated">
                    <time>{formatTime(lastSeenAt)}</time>
                  </div>
                  {canRevoke ? (
                    <button
                      className="admin-btn admin-btn--danger"
                      onClick={() => void remove(item)}
                      disabled={removed}
                    >
                      {removed ? "已删除" : "删除"}
                    </button>
                  ) : (
                    <span className="device-status__readonly">只读</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}
