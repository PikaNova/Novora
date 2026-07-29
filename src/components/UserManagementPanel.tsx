import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { SchoolClass, SchoolGrade } from "../types/school";
import AdminModalPortal from './AdminModalPortal';
import {
  adminCan,
  getAdminUser,
  logoutAdmin,
  type AdminScope,
  type AdminUserContext,
} from "../services/examService";
import {
  changeOwnPassword,
  changeOwnCredentials,
  changeOwnUsername,
  deleteManagedUser,
  deleteManagedRole,
  fetchAuditLogs,
  fetchUserManagement,
  resetManagedUserPassword,
  saveManagedRole,
  saveManagedUser,
  type AuditLog,
  type ManagedRole,
  type ManagedUser,
  AdminApiError,
} from "../services/adminUsers";
import ClassMultiPicker, { type ClassPickerOption } from "./ClassMultiPicker";
import InlineSelect from "./InlineSelect";
import AdminWizardSteps, { AdminWorkflowClose } from "./AdminWizardSteps";
import { confirmDialog } from "../services/appDialog";

type Props = {
  grades: SchoolGrade[];
  classes: SchoolClass[];
  currentUser?: AdminUserContext | null;
  forcePasswordChange?: boolean;
  openBatchCreate?: boolean;
};
type Section = "users" | "roles" | "audit";
type UserDraft = {
  id?: number;
  username: string;
  displayName: string;
  password: string;
  roleId: string;
  status: "active" | "disabled";
  allScope: boolean;
  gradeIds: string[];
  classIds: string[];
};
type RoleDraft = {
  id?: string;
  name: string;
  description: string;
  permissions: string[];
};
type PasswordDraft = {
  current: string;
  username: string;
  next: string;
  confirm: string;
};
type BatchUserDraft = { prefix: string; password: string; classIds: string[] };
type BatchCredential = {
  displayName: string;
  username: string;
  password: string;
  gradeName: string;
  className: string;
};
type RoleLevel = "none" | "read" | "manage";

const ROLE_MODULES: Array<{
  id: string;
  label: string;
  read: string[];
  manage: string[];
}> = [
  { id: "overview", label: "运行总览", read: ["overview.read"], manage: [] },
  {
    id: "major",
    label: "大型考试",
    read: ["major.read", "major.export"],
    manage: [
      "major.create",
      "major.quick_create",
      "major.edit",
      "major.delete",
      "major.import",
    ],
  },
  {
    id: "weekly",
    label: "周测安排",
    read: ["weekly.read", "weekly.export"],
    manage: [
      "weekly.create",
      "weekly.edit",
      "weekly.delete",
      "weekly.copy",
      "weekly.override",
      "weekly.import",
    ],
  },
  {
    id: "school",
    label: "年级与班级",
    read: ["school.read"],
    manage: ["school.grade_manage", "school.class_manage"],
  },
  {
    id: "device",
    label: "设备管理",
    read: ["device.read"],
    manage: ["device.bind", "device.revoke"],
  },
  {
    id: "calendar",
    label: "提醒与校历",
    read: ["alerts.read"],
    manage: [
      "alerts.edit",
      "schedule.mode_edit",
      "schedule.conflict_edit",
      "schedule.term_edit",
      "schedule.ab_week_edit",
      "schedule.holiday_edit",
    ],
  },
];

const moduleLevel = (
  permissions: string[],
  module: (typeof ROLE_MODULES)[number],
): RoleLevel =>
  module.manage.some((item) => permissions.includes(item))
    ? "manage"
    : module.read.some((item) => permissions.includes(item))
      ? "read"
      : "none";

const PERMISSION_GROUPS: Array<{ prefix: string; label: string }> = [
  { prefix: "overview.", label: "概览" },
  { prefix: "major.", label: "大型考试" },
  { prefix: "weekly.", label: "周测" },
  { prefix: "school.", label: "年级与班级" },
  { prefix: "device.", label: "设备" },
  { prefix: "schedule.", label: "调度规则" },
  { prefix: "alerts.", label: "提醒" },
  { prefix: "settings.", label: "设置" },
  { prefix: "initialization.", label: "初始化" },
  { prefix: "demo_data.", label: "演示数据" },
  { prefix: "user.", label: "用户" },
  { prefix: "role.", label: "角色" },
  { prefix: "audit.", label: "日志" },
  { prefix: "deployment.", label: "部署" },
];

const PERMISSION_META: Record<string, { label: string; description: string }> =
  {
    "overview.read": {
      label: "查看管理概览",
      description: "进入管理后台并查看基础运行状态。",
    },
    "major.read": {
      label: "查看大型考试",
      description: "查看授权范围内的大型考试及科目安排。",
    },
    "major.create": {
      label: "新建大型考试",
      description: "创建新的大型考试计划。",
    },
    "major.quick_create": {
      label: "快速发布班级考试",
      description:
        "为授权班级快速发布一场临时考试，不可发布全校或年级统一考试。",
    },
    "major.edit": {
      label: "编辑大型考试",
      description: "修改考试名称、适用年级和科目时间。",
    },
    "major.delete": {
      label: "删除大型考试",
      description: "删除已有大型考试计划。",
    },
    "major.import": {
      label: "导入大型考试",
      description: "通过 JSON 批量导入考试安排。",
    },
    "major.export": {
      label: "导出大型考试",
      description: "导出当前考试安排用于备份或复用。",
    },
    "weekly.read": {
      label: "查看周测",
      description: "查看授权班级的周测计划和日历。",
    },
    "weekly.create": {
      label: "新建周测",
      description: "为班级创建新的周测计划。",
    },
    "weekly.edit": {
      label: "编辑周测",
      description: "修改周测科目、时间和 A/B 周设置。",
    },
    "weekly.delete": { label: "删除周测", description: "删除已有周测计划。" },
    "weekly.copy": {
      label: "复制周测计划",
      description: "将一个计划批量应用到其他班级。",
    },
    "weekly.override": {
      label: "处理周测例外",
      description: "设置单日停用、补测或冲突覆盖。",
    },
    "weekly.import": { label: "导入周测", description: "批量导入周测计划。" },
    "weekly.export": {
      label: "导出周测",
      description: "导出周测计划用于备份。",
    },
    "school.read": {
      label: "查看年级班级",
      description: "查看学校年级和班级结构。",
    },
    "school.grade_manage": {
      label: "管理年级",
      description: "新增或删除年级。",
    },
    "school.class_manage": {
      label: "管理班级",
      description: "新增、调整或删除班级。",
    },
    "device.read": {
      label: "查看设备",
      description: "查看客户端绑定和当前运行状态。",
    },
    "device.bind": {
      label: "绑定设备",
      description: "将客户端绑定到指定年级和班级。",
    },
    "device.revoke": {
      label: "删除设备",
      description: "撤销设备实例并要求客户端重新绑定。",
    },
    "schedule.mode_edit": {
      label: "修改运行模式",
      description: "切换大型考试、周测或自动调度模式。",
    },
    "schedule.conflict_edit": {
      label: "修改冲突规则",
      description: "设置大型考试与周测发生冲突时的处理方式。",
    },
    "schedule.term_edit": {
      label: "修改学期日期",
      description: "调整学期开始日期和周次基准。",
    },
    "schedule.ab_week_edit": {
      label: "修改 A/B 周",
      description: "配置 A/B 周交替规则。",
    },
    "schedule.holiday_edit": {
      label: "修改节假日",
      description: "配置法定节假日排除和未来年度数据。",
    },
    "alerts.read": {
      label: "查看提醒",
      description: "查看全屏提醒与自定义提醒配置。",
    },
    "alerts.edit": {
      label: "编辑提醒",
      description: "修改提醒内容、时间和启停状态。",
    },
    "settings.read": {
      label: "查看系统设置",
      description: "查看校时、显示、字体和版本信息。",
    },
    "settings.edit": {
      label: "编辑系统设置",
      description: "修改系统级显示和运行参数。",
    },
    "initialization.run": {
      label: "运行初始化向导",
      description: "重新配置学校结构和初始数据。",
    },
    "demo_data.delete": {
      label: "清除演示数据",
      description: "删除初始化向导导入的测试内容。",
    },
    "user.read": {
      label: "查看管理员",
      description: "查看管理员账号、角色和数据范围。",
    },
    "user.create": {
      label: "创建管理员",
      description: "新增客户端管理员账号。",
    },
    "user.edit": {
      label: "编辑管理员",
      description: "修改显示名称、角色、状态和数据范围。",
    },
    "user.disable": {
      label: "启停管理员",
      description: "停用或重新启用管理员账号。",
    },
    "user.reset_password": {
      label: "重置他人密码",
      description: "为可管理的账号设置临时密码并使旧会话失效。",
    },
    "user.delete": {
      label: "删除管理员",
      description: "删除管理范围内的账号并立即撤销其所有会话。",
    },
    "role.manage": {
      label: "管理角色",
      description: "创建、修改和删除自定义角色。",
    },
    "audit.read": {
      label: "查看操作日志",
      description: "查看最近的登录与数据修改记录。",
    },
    "deployment.trigger": {
      label: "触发重新部署",
      description: "通过已配置的部署钩子更新应用。",
    },
  };

const ACTION_LABEL: Record<string, string> = {
  "auth.login": "登录后台",
  "user.create": "创建用户",
  "user.update": "修改用户",
  "user.password.reset": "重置密码",
  "user.password.change": "修改自己的密码",
  "user.password.recover": "恢复超级管理员密码",
  "role.create": "创建角色",
  "role.update": "修改角色",
  "role.delete": "删除角色",
  "user.delete": "删除用户",
  "exam-data.update": "修改考试数据",
  "device.revoke": "删除设备绑定",
};
const fmt = (value?: number | null) =>
  value
    ? new Date(Number(value)).toLocaleString("zh-CN", { hour12: false })
    : "从未登录";
const permissionMeta = (permission: string) =>
  PERMISSION_META[permission] ?? {
    label: permission,
    description: "自定义系统权限。",
  };
const generateTemporaryPassword = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const values = new Uint32Array(14);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join(
    "",
  );
};

function scopeText(
  user: ManagedUser,
  grades: SchoolGrade[],
  classes: SchoolClass[],
) {
  if (user.scopes.some((scope) => scope.type === "all")) return "全校";
  const names = user.scopes.map((scope) =>
    scope.type === "grade"
      ? grades.find((item) => item.id === scope.gradeId)?.name
      : `${grades.find((item) => item.id === scope.gradeId)?.name ?? "未知年级"} · ${classes.find((item) => item.id === scope.classId)?.name ?? "未知班级"}`,
  );
  return names.filter(Boolean).join("、") || "未分配范围";
}

function draftScopes(draft: UserDraft, classes: SchoolClass[]): AdminScope[] {
  if (draft.allScope) return [{ type: "all", gradeId: "", classId: "" }];
  if (draft.roleId === "class_admin") {
    return draft.classIds.map((classId) => ({
      type: "class" as const,
      gradeId: classes.find((item) => item.id === classId)?.gradeId ?? "",
      classId,
    }));
  }
  return [
    ...draft.gradeIds.map((gradeId) => ({
      type: "grade" as const,
      gradeId,
      classId: "",
    })),
    ...draft.classIds.map((classId) => ({
      type: "class" as const,
      gradeId: classes.find((item) => item.id === classId)?.gradeId ?? "",
      classId,
    })),
  ];
}

function validateUserScopes(draft: UserDraft) {
  if (draft.roleId === "super_admin" || draft.allScope) return "";
  if (draft.roleId === "class_admin" && !draft.classIds.length)
    return "班级管理员必须选择至少一个具体班级";
  if (draft.roleId === "grade_admin" && !draft.gradeIds.length)
    return "年级管理员必须选择至少一个年级";
  if (!draft.gradeIds.length && !draft.classIds.length)
    return "至少选择一个年级或班级";
  return "";
}

export default function UserManagementPanel({
  grades,
  classes,
  currentUser,
  forcePasswordChange = false,
  openBatchCreate = false,
}: Props) {
  const navigate = useNavigate();
  const current = currentUser ?? getAdminUser();
  const canReadUsers = adminCan("user.read", current);
  const canCreateUser = adminCan("user.create", current);
  const canEditUser = adminCan("user.edit", current);
  const canResetPassword = adminCan("user.reset_password", current);
  const canDeleteUser = adminCan("user.delete", current);
  const canManageRoles = adminCan("role.manage", current);
  const canReadAudit = adminCan("audit.read", current);
  const [section, setSection] = useState<Section>("users");
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [roles, setRoles] = useState<ManagedRole[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(
    canReadUsers && !current?.mustChangePassword,
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [userDraft, setUserDraft] = useState<UserDraft | null>(null);
  const [userWizardStep, setUserWizardStep] = useState(0);
  const [batchUserDraft, setBatchUserDraft] = useState<BatchUserDraft | null>(
    null,
  );
  const [batchUserWizardStep, setBatchUserWizardStep] = useState(0);
  const [batchCredentials, setBatchCredentials] = useState<
    BatchCredential[] | null
  >(null);
  const [userErrors, setUserErrors] = useState<Record<string, string>>({});
  const [roleDraft, setRoleDraft] = useState<RoleDraft | null>(null);
  const [roleWizardStep, setRoleWizardStep] = useState(0);
  const [resetTarget, setResetTarget] = useState<ManagedUser | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetMode, setResetMode] = useState<"generated" | "manual">(
    "generated",
  );
  const [issuedPassword, setIssuedPassword] = useState<{
    displayName: string;
    password: string;
  } | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const [passwordOpen, setPasswordOpen] = useState(
    forcePasswordChange || current?.mustChangePassword === true,
  );
  const [passwordDraft, setPasswordDraft] = useState<PasswordDraft>({
    current: "",
    username: current?.username ?? "",
    next: "",
    confirm: "",
  });
  const [usernameOpen, setUsernameOpen] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState({
    currentPassword: "",
    username: current?.username ?? "",
  });
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>(
    {},
  );
  const [usernameError, setUsernameError] = useState("");
  const [resetError, setResetError] = useState("");
  const [batchDeleteMode, setBatchDeleteMode] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [batchDeleteGradeId, setBatchDeleteGradeId] = useState("");

  const load = async () => {
    if (!canReadUsers || current?.mustChangePassword) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const data = await fetchUserManagement();
      setUsers(data.users);
      setRoles(data.roles);
      setPermissions(data.permissions);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "用户数据加载失败");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (userDraft) setUserWizardStep(0);
  }, [userDraft !== null]);
  useEffect(() => {
    if (roleDraft) setRoleWizardStep(0);
  }, [roleDraft !== null]);
  useEffect(() => {
    if (batchUserDraft) setBatchUserWizardStep(0);
  }, [batchUserDraft !== null]);
  useEffect(() => {
    if (forcePasswordChange || current?.mustChangePassword)
      setPasswordOpen(true);
  }, [forcePasswordChange, current?.mustChangePassword]);
  useEffect(() => {
    if (openBatchCreate && canCreateUser)
      setBatchUserDraft({ prefix: "class_admin", password: "", classIds: [] });
  }, [canCreateUser, openBatchCreate]);
  useEffect(() => {
    if (section !== "audit") return;
    fetchAuditLogs()
      .then(setLogs)
      .catch((error) =>
        setMessage(error instanceof Error ? error.message : "日志加载失败"),
      );
  }, [section]);

  const groupedPermissions = useMemo(
    () =>
      PERMISSION_GROUPS.map((group) => ({
        ...group,
        items: permissions.filter((item) => item.startsWith(group.prefix)),
      })).filter((group) => group.items.length),
    [permissions],
  );
  const canAssignAll =
    !!current &&
    (current.permissions.includes("*") ||
      current.scopes.some((scope) => scope.type === "all"));
  const visibleGradeIds = new Set(
    canAssignAll
      ? grades.map((item) => item.id)
      : current?.scopes
          .filter((scope) => scope.type === "grade")
          .map((scope) => scope.gradeId) || [],
  );
  const visibleClassIds = new Set(
    canAssignAll
      ? classes.map((item) => item.id)
      : current?.scopes
          .filter((scope) => scope.type === "class")
          .map((scope) => scope.classId) || [],
  );
  classes.forEach((item) => {
    if (visibleGradeIds.has(item.gradeId)) visibleClassIds.add(item.id);
  });
  const visibleGrades = grades.filter((item) => visibleGradeIds.has(item.id));
  const visibleClasses = classes.filter((item) => visibleClassIds.has(item.id));
  const classPickerOptions = useMemo<ClassPickerOption[]>(
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
  const delegableRoles = roles.filter(
    (role) =>
      current?.permissions.includes("*") ||
      (!role.permissions.includes("*") &&
        role.permissions.every((permission) =>
          current?.permissions.includes(permission),
        )),
  );
  const beginCreateUser = () => {
    setUserErrors({});
    setUserDraft({
      username: "",
      displayName: "",
      password: "",
      roleId:
        delegableRoles.find((role) => role.id === "viewer")?.id ??
        delegableRoles[0]?.id ??
        "",
      status: "active",
      allScope: false,
      gradeIds: [],
      classIds: [],
    });
  };
  const beginEditUser = (user: ManagedUser) => {
    setUserErrors({});
    setUserDraft({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      password: "",
      roleId: user.roleId,
      status: user.status,
      allScope: user.scopes.some((scope) => scope.type === "all"),
      gradeIds: user.scopes
        .filter((scope) => scope.type === "grade")
        .map((scope) => scope.gradeId),
      classIds: user.scopes
        .filter((scope) => scope.type === "class")
        .map((scope) => scope.classId),
    });
  };

  const submitUser = async () => {
    if (!userDraft) return;
    const errors: Record<string, string> = {};
    if (
      !userDraft.id &&
      !/^[A-Za-z0-9._-]{3,40}$/.test(userDraft.username.trim())
    )
      errors.username = "请输入 3-40 位字母、数字、点、横线或下划线";
    if (!userDraft.displayName.trim()) errors.displayName = "请输入显示名称";
    if (!userDraft.id && userDraft.password.length < 8)
      errors.password = "初始密码至少需要 8 位";
    if (!userDraft.roleId) errors.roleId = "请选择角色";
    const scopeError = validateUserScopes(userDraft);
    if (scopeError) errors.scopes = scopeError;
    if (Object.keys(errors).length) {
      setUserErrors(errors);
      if (errors.scopes) setUserWizardStep(1);
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const next = await saveManagedUser({
        action: userDraft.id ? "update" : "create",
        id: userDraft.id,
        username: userDraft.username,
        displayName: userDraft.displayName,
        password: userDraft.password,
        roleId: userDraft.roleId,
        status: userDraft.status,
        scopes: draftScopes(userDraft, classes),
      });
      setUsers(next);
      setUserDraft(null);
      setMessage(
        userDraft.id
          ? "用户权限已更新，原登录会话已失效。"
          : "用户已创建，首次登录必须修改密码。",
      );
    } catch (error) {
      if (error instanceof AdminApiError && error.field) {
        setUserErrors({ [error.field]: error.message });
        if (error.field === "scopes") setUserWizardStep(1);
      } else setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };
  const submitBatchUsers = async () => {
    if (!batchUserDraft?.classIds.length) {
      setMessage("请至少选择一个班级。");
      return;
    }
    if (!/^[A-Za-z0-9._-]{2,30}$/.test(batchUserDraft.prefix)) {
      setMessage("账号前缀需为 2-30 位字母、数字、点、横线或下划线。");
      return;
    }
    if (batchUserDraft.password.length < 8) {
      setMessage("批量账号初始密码至少需要 8 位。");
      return;
    }
    if (!delegableRoles.some((role) => role.id === "class_admin")) {
      setMessage("当前账号不能下发班级管理员角色。");
      return;
    }
    setBusy(true);
    setMessage("");
    let completed = 0;
    let latest = users;
    const created: BatchCredential[] = [];
    try {
      for (const classId of batchUserDraft.classIds) {
        const schoolClass = classes.find((item) => item.id === classId)!;
        const grade = grades.find((item) => item.id === schoolClass.gradeId);
        const suffix = String(
          classes
            .filter((item) => item.gradeId === schoolClass.gradeId)
            .findIndex((item) => item.id === classId) + 1,
        ).padStart(2, "0");
        const gradeIndex = String(
          grades.findIndex((item) => item.id === schoolClass.gradeId) + 1,
        );
        latest = await saveManagedUser({
          action: "create",
          username: `${batchUserDraft.prefix}_g${gradeIndex}c${suffix}`,
          displayName: `${grade?.name ?? ""}${schoolClass.name}管理员`,
          password: batchUserDraft.password,
          roleId: "class_admin",
          status: "active",
          scopes: [{ type: "class", gradeId: schoolClass.gradeId, classId }],
        });
        created.push({
          displayName: `${grade?.name ?? ""}${schoolClass.name}管理员`,
          username: `${batchUserDraft.prefix}_g${gradeIndex}c${suffix}`,
          password: batchUserDraft.password,
          gradeName: grade?.name ?? "",
          className: schoolClass.name,
        });
        completed += 1;
      }
      setUsers(latest);
      setBatchUserDraft(null);
      setBatchCredentials(created);
      setMessage(
        `已创建 ${completed} 个班级管理员账号，首次登录均需设置自己的用户名和新密码。`,
      );
    } catch (error) {
      setUsers(latest);
      setMessage(
        `已创建 ${completed} 个账号，随后停止：${error instanceof Error ? error.message : "创建失败"}`,
      );
    } finally {
      setBusy(false);
    }
  };
  const exportBatchCredentials = () => {
    if (!batchCredentials?.length) return;
    const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const rows = [
      ["管理员", "用户名", "初始密码", "年级", "班级", "首次登录要求"],
      ...batchCredentials.map((item) => [
        item.displayName,
        item.username,
        item.password,
        item.gradeName,
        item.className,
        "修改用户名和密码",
      ]),
    ];
    const file = new Blob(
      [`\uFEFF${rows.map((row) => row.map(quote).join(",")).join("\r\n")}`],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Novora-班级管理员初始账号-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const submitRole = async () => {
    if (!roleDraft) return;
    setBusy(true);
    setMessage("");
    try {
      setRoles(await saveManagedRole(roleDraft));
      setRoleDraft(null);
      setMessage("角色权限已保存。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "角色保存失败");
    } finally {
      setBusy(false);
    }
  };
  const submitReset = async () => {
    if (!resetTarget || resetPassword.length < 8) {
      setResetError("新密码至少需要 8 位");
      return;
    }
    setBusy(true);
    try {
      const issued = {
        displayName: resetTarget.displayName,
        password: resetPassword,
      };
      await resetManagedUserPassword(resetTarget.id, resetPassword);
      setResetTarget(null);
      setResetPassword("");
      setResetError("");
      setIssuedPassword(issued);
      setCopyStatus("");
      setMessage("密码已重置，该用户需要重新登录并修改密码。");
    } catch (error) {
      setResetError(error instanceof Error ? error.message : "重置失败");
    } finally {
      setBusy(false);
    }
  };
  const submitOwnPassword = async () => {
    const errors: Record<string, string> = {};
    const requiresInitialUpdate =
      forcePasswordChange || current?.mustChangePassword;
    if (!passwordDraft.current) errors.current = "请输入当前密码";
    if (
      requiresInitialUpdate &&
      !/^[A-Za-z0-9._-]{3,40}$/.test(passwordDraft.username.trim())
    )
      errors.username = "用户名需为 3-40 位字母、数字、点、横线或下划线";
    if (
      requiresInitialUpdate &&
      current?.roleId === "class_admin" &&
      passwordDraft.username.trim().toLowerCase() ===
        current.username.toLowerCase()
    )
      errors.username = "班级管理员首次登录必须设置新的用户名";
    if (passwordDraft.next.length < 8) errors.next = "新密码至少需要 8 位";
    if (passwordDraft.next !== passwordDraft.confirm)
      errors.confirm = "两次输入的新密码不一致";
    if (Object.keys(errors).length) {
      setPasswordErrors(errors);
      return;
    }
    setBusy(true);
    setPasswordErrors({});
    try {
      if (requiresInitialUpdate)
        await changeOwnCredentials(
          passwordDraft.current,
          passwordDraft.username.trim(),
          passwordDraft.next,
        );
      else await changeOwnPassword(passwordDraft.current, passwordDraft.next);
      logoutAdmin();
      navigate("/login?next=/admin", { replace: true });
    } catch (error) {
      setPasswordErrors({
        current: error instanceof Error ? error.message : "密码修改失败",
      });
      setBusy(false);
    }
  };
  const submitOwnUsername = async () => {
    if (!/^[A-Za-z0-9._-]{3,40}$/.test(usernameDraft.username.trim())) {
      setUsernameError("用户名需为 3-40 位字母、数字、点、横线或下划线");
      return;
    }
    if (!usernameDraft.currentPassword) {
      setUsernameError("请输入当前登录密码以验证身份");
      return;
    }
    setBusy(true);
    setUsernameError("");
    try {
      await changeOwnUsername(
        usernameDraft.currentPassword,
        usernameDraft.username.trim(),
      );
      logoutAdmin();
      navigate("/login?next=/admin", { replace: true });
    } catch (error) {
      setUsernameError(
        error instanceof Error ? error.message : "用户名修改失败",
      );
      setBusy(false);
    }
  };

  const setRoleModuleLevel = (
    module: (typeof ROLE_MODULES)[number],
    level: RoleLevel,
  ) =>
    setRoleDraft((value) => {
      if (!value) return value;
      const modulePermissions = [...module.read, ...module.manage];
      const retained = value.permissions.filter(
        (item) => !modulePermissions.includes(item),
      );
      const added =
        level === "none"
          ? []
          : level === "read"
            ? module.read
            : [...module.read, ...module.manage];
      return { ...value, permissions: [...new Set([...retained, ...added])] };
    });

  const removeUser = async (user: ManagedUser) => {
    if (
      !(await confirmDialog({
        title: `删除管理员“${user.displayName}”`,
        message: "该账号会立即退出所有设备，且无法恢复。",
        tone: "danger",
        confirmLabel: "删除管理员",
      }))
    )
      return;
    try {
      setUsers(await deleteManagedUser(user.id));
      setMessage(`管理员“${user.displayName}”已删除。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除用户失败");
    }
  };
  const removableUsers = users.filter((user) => user.id !== current?.id);
  const batchDeleteUsers = useMemo(
    () =>
      batchDeleteGradeId
        ? removableUsers.filter((user) =>
            user.scopes.some(
              (scope) =>
                scope.type !== "all" && scope.gradeId === batchDeleteGradeId,
            ),
          )
        : removableUsers,
    [batchDeleteGradeId, removableUsers],
  );
  const removeSelectedUsers = async () => {
    const targets = removableUsers.filter((user) => selectedUserIds.includes(user.id));
    if (!targets.length) return;
    if (!(await confirmDialog({ title: `删除 ${targets.length} 个管理员账号`, message: "删除后将立即撤销这些账号的会话，且无法恢复。", tone: "danger", confirmLabel: "删除所选账号" }))) return;
    setBusy(true);
    const failed: number[] = [];
    let nextUsers = users;
    for (const target of targets) {
      try { nextUsers = await deleteManagedUser(target.id); }
      catch { failed.push(target.id); }
    }
    setUsers(nextUsers);
    setSelectedUserIds(failed);
    setBusy(false);
    setMessage(failed.length ? `已删除 ${targets.length - failed.length} 个账号；${failed.length} 个账号删除失败，请重试。` : `已删除 ${targets.length} 个账号。`);
    if (!failed.length) setBatchDeleteMode(false);
  };
  const removeRole = async (role: ManagedRole) => {
    if (
      !(await confirmDialog({
        title: `删除角色“${role.name}”`,
        message: "删除后无法再将该角色分配给管理员。",
        tone: "danger",
        confirmLabel: "删除角色",
      }))
    )
      return;
    try {
      setRoles(await deleteManagedRole(role.id));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除失败");
    }
  };

  return (
    <main className="user-management">
      {batchUserDraft && (
        <AdminModalPortal className="admin-modal-overlay">
          <div
            className="admin-modal admin-modal--wide admin-modal--workflow"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="admin-modal__title admin-workflow-head">批量添加班级管理员</h2>
            <AdminWorkflowClose onClick={() => setBatchUserDraft(null)} />
            <div className="admin-workflow-layout">
              <AdminWizardSteps
                active={batchUserWizardStep}
                steps={[
                  { label: "账号规则", hint: "前缀和初始密码" },
                  { label: "选择班级", hint: "批量指定目标班级" },
                  { label: "确认创建", hint: "生成并导出账号" },
                ]}
                summary={<><span>将创建</span><strong>{batchUserDraft.classIds.length} 个账号</strong><span>前缀：{batchUserDraft.prefix || "未填写"}</span></>}
              />
              <div className="admin-workflow-content" key={batchUserWizardStep}>
            {batchUserWizardStep === 0 && <div className="admin-workflow-pane">
              <p className="admin-modal__body">每个班级创建一个独立账号，用户名按“前缀 + 年级序号 + 班级序号”生成。</p>
            <div className="user-editor__grid">
              <label className="admin-label">
                账号前缀
                <input
                  className="admin-input"
                  value={batchUserDraft.prefix}
                  onChange={(event) =>
                    setBatchUserDraft(
                      (value) =>
                        value && { ...value, prefix: event.target.value },
                    )
                  }
                  placeholder="class_admin"
                />
              </label>
              <label className="admin-label">
                统一初始密码
                <input
                  className="admin-input"
                  type="password"
                  value={batchUserDraft.password}
                  onChange={(event) =>
                    setBatchUserDraft(
                      (value) =>
                        value && { ...value, password: event.target.value },
                    )
                  }
                  placeholder="至少 8 位，首次登录后必须修改"
                />
              </label>
            </div>
            </div>}
            {batchUserWizardStep === 1 && <div className="admin-workflow-pane">
            <div className="admin-label">
              创建账号的班级
              <ClassMultiPicker
                options={classPickerOptions}
                selectedIds={batchUserDraft.classIds}
                onChange={(ids) =>
                  setBatchUserDraft(
                    (value) => value && { ...value, classIds: ids },
                  )
                }
              />
            </div>
            <p className="admin-major-card__hint">
              示例：class_admin_g1c01。若用户名已存在，已成功创建的账号会保留，并明确提示停止位置。
            </p>
            </div>}
            {batchUserWizardStep === 2 && <div className="admin-workflow-pane">
              <div className="admin-workflow-review">
                <span>账号前缀<strong>{batchUserDraft.prefix}</strong></span>
                <span>目标班级<strong>{batchUserDraft.classIds.length} 个班级</strong></span>
                <span>初始密码<strong>{batchUserDraft.password.length >= 8 ? "已设置，创建后必须修改" : "长度不足 8 位"}</strong></span>
                <span>结果导出<strong>创建完成后可立即导出 CSV</strong></span>
              </div>
            </div>}
              </div>
            </div>
            <div className="admin-modal__actions">
              <button
                className="admin-btn"
                disabled={busy}
                onClick={batchUserWizardStep === 0 ? () => setBatchUserDraft(null) : () => setBatchUserWizardStep((value) => value - 1)}
              >
                {batchUserWizardStep === 0 ? "取消" : "上一步"}
              </button>
              {batchUserWizardStep < 2 ? <button className="admin-btn admin-btn--primary admin-workflow-actions-spacer" onClick={() => {
                if (batchUserWizardStep === 0 && (!batchUserDraft.prefix.trim() || batchUserDraft.password.length < 8)) return;
                if (batchUserWizardStep === 1 && !batchUserDraft.classIds.length) return;
                setBatchUserWizardStep((value) => value + 1);
              }}>下一步</button> : <button className="admin-btn admin-btn--primary admin-workflow-actions-spacer" disabled={busy || !batchUserDraft.classIds.length} onClick={() => void submitBatchUsers()}>{busy ? "正在创建…" : `创建 ${batchUserDraft.classIds.length} 个账号`}</button>}
            </div>
          </div>
        </AdminModalPortal>
      )}
      {batchCredentials && (
        <AdminModalPortal className="admin-modal-overlay">
          <div
            className="admin-modal admin-modal--wide"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="admin-modal__title">批量账号已创建</h2>
            <p className="admin-modal__body">
              初始密码仅在当前页面显示。请使用受控渠道分发，关闭此窗口后不能再次导出明文密码。
            </p>
            <div className="user-management__batch-credentials">
              {batchCredentials.map((item) => (
                <div key={item.username}>
                  <strong>{item.displayName}</strong>
                  <code>{item.username}</code>
                  <code>{item.password}</code>
                  <small>
                    {item.gradeName} · {item.className}
                  </small>
                </div>
              ))}
            </div>
            <div className="admin-modal__actions">
              <button
                className="admin-btn admin-btn--primary"
                onClick={exportBatchCredentials}
              >
                导出 CSV
              </button>
              <button
                className="admin-btn"
                onClick={() => setBatchCredentials(null)}
              >
                我已妥善保存
              </button>
            </div>
          </div>
        </AdminModalPortal>
      )}
      <div className="device-status__heading user-management__heading">
        <div>
          <h2>{canReadUsers ? "用户与权限" : "我的账户"}</h2>
          <p>
            {canReadUsers
              ? "为不同管理员分配可编辑内容和年级、班级范围。所有限制均由服务端再次校验。"
              : "管理当前账号的登录用户名和密码。"}
          </p>
        </div>
        <div className="user-management__heading-actions">
          <button
            className="admin-btn"
            onClick={() => {
              setUsernameDraft({
                currentPassword: "",
                username: current?.username ?? "",
              });
              setUsernameOpen(true);
            }}
          >
            修改用户名
          </button>
          <button className="admin-btn" onClick={() => setPasswordOpen(true)}>
            修改密码
          </button>
          {section === "users" && canCreateUser && (
            <>
              <button
                className="admin-btn"
                onClick={() =>
                  setBatchUserDraft({
                    prefix: "class_admin",
                    password: "",
                    classIds: [],
                  })
                }
              >
                批量添加班级管理员
              </button>
              <button
                className="admin-btn admin-btn--primary"
                onClick={beginCreateUser}
              >
                添加用户
              </button>
            </>
          )}
          {section === "users" && canDeleteUser && (
            <button
              className={`admin-btn${batchDeleteMode ? " admin-btn--danger" : ""}`}
              onClick={() => {
                setBatchDeleteMode((value) => !value);
                setSelectedUserIds([]);
                setBatchDeleteGradeId("");
              }}
            >
              {batchDeleteMode ? "退出批量删除" : "批量删除账户"}
            </button>
          )}
          {section === "roles" && canManageRoles && (
            <button
              className="admin-btn admin-btn--primary"
              onClick={() =>
                setRoleDraft({ name: "", description: "", permissions: [] })
              }
            >
              新建角色
            </button>
          )}
        </div>
      </div>
      {current?.mustChangePassword && (
        <div className="admin-info-banner admin-info-banner--warn">
          当前使用的是初始账户信息。请先设置自己的用户名和新密码，完成后重新登录。
        </div>
      )}
      {canReadUsers && (
        <div className="user-management__tabs">
          <button
            className={section === "users" ? "is-active" : ""}
            onClick={() => setSection("users")}
          >
            管理员
          </button>
          {canManageRoles && (
            <button
              className={section === "roles" ? "is-active" : ""}
              onClick={() => setSection("roles")}
            >
              角色权限
            </button>
          )}
          {canReadAudit && (
            <button
              className={section === "audit" ? "is-active" : ""}
              onClick={() => setSection("audit")}
            >
              操作日志
            </button>
          )}
        </div>
      )}
      {message && (
        <div className="admin-info-banner" aria-live="polite">
          {message}
        </div>
      )}
      {loading ? (
        <div className="admin-loading">正在读取用户权限…</div>
      ) : !canReadUsers ? (
        <section className="user-management__account-card">
          <span>当前账号</span>
          <strong>{current?.displayName}</strong>
          <code>@{current?.username}</code>
          <small>{current?.roleName}</small>
        </section>
      ) : section === "users" ? (
        <>
          <div className="device-status__stats">
            <div>
              <span>管理员总数</span>
              <strong>{users.length}</strong>
            </div>
            <div>
              <span>当前启用</span>
              <strong>
                {users.filter((user) => user.status === "active").length}
              </strong>
            </div>
            <div>
              <span>自定义角色</span>
              <strong>{roles.filter((role) => !role.builtIn).length}</strong>
            </div>
            <div>
              <span>需修改密码</span>
              <strong>
                {users.filter((user) => user.mustChangePassword).length}
              </strong>
            </div>
          </div>
          {batchDeleteMode && (
            <div className="user-management__batch-delete">
              <InlineSelect
                className="admin-input user-management__batch-grade-filter"
                value={batchDeleteGradeId}
                onChange={(value) => {
                  setBatchDeleteGradeId(value);
                  setSelectedUserIds([]);
                }}
                options={[
                  { value: "", label: "全部年级" },
                  ...visibleGrades.map((grade) => ({
                    value: grade.id,
                    label: grade.name,
                  })),
                ]}
              />
              <label>
                <input
                  type="checkbox"
                  checked={batchDeleteUsers.length > 0 && batchDeleteUsers.every((user) => selectedUserIds.includes(user.id))}
                  onChange={(event) => setSelectedUserIds(event.target.checked ? batchDeleteUsers.map((user) => user.id) : [])}
                />
                选择当前可删除账号
              </label>
              <span>已选择 {selectedUserIds.length} 个账号</span>
              <button className="admin-btn admin-btn--danger" disabled={busy || !selectedUserIds.length} onClick={() => void removeSelectedUsers()}>
                删除所选账号
              </button>
            </div>
          )}
          <div className="user-management__list">
            {batchDeleteMode && batchDeleteUsers.length === 0 ? (
              <div className="admin-empty"><p>当前年级没有可批量删除的账号。</p></div>
            ) : (batchDeleteMode ? batchDeleteUsers : users).map((user) => (
              <article
                className={`user-management__row${user.status === "disabled" ? " is-disabled" : ""}${batchDeleteMode ? " is-batch" : ""}`}
                key={user.id}
              >
                {batchDeleteMode && user.id !== current?.id && (
                  <input
                    className="user-management__batch-check"
                    type="checkbox"
                    checked={selectedUserIds.includes(user.id)}
                    onChange={(event) => setSelectedUserIds((ids) => event.target.checked ? [...ids, user.id] : ids.filter((id) => id !== user.id))}
                    aria-label={`选择 ${user.displayName}`}
                  />
                )}
                <div className="user-management__identity">
                  <strong>
                    {user.displayName}
                    {user.id === current?.id && (
                      <span className="user-management__self">当前账号</span>
                    )}
                  </strong>
                  <code>@{user.username}</code>
                </div>
                <div className="user-management__scope-cell">
                  <span className="user-management__role">{user.roleName}</span>
                  <small>{scopeText(user, grades, classes)}</small>
                </div>
                <div className="user-management__status-cell">
                  <small>
                    {user.status === "active" ? "已启用" : "已停用"} ·{" "}
                    {fmt(user.lastLoginAt)}
                  </small>
                  {user.mustChangePassword && <em>首次登录需改密码</em>}
                </div>
                {(canEditUser || canResetPassword || canDeleteUser) && (
                  <div className="user-management__actions">
                    {canEditUser && (
                      <button
                        className="admin-btn"
                        onClick={() => beginEditUser(user)}
                      >
                        编辑
                      </button>
                    )}
                    {canResetPassword && user.id !== current?.id && (
                      <button
                        className="admin-btn"
                        onClick={() => {
                          setResetTarget(user);
                          setResetMode("generated");
                          setResetPassword(generateTemporaryPassword());
                          setResetError("");
                        }}
                      >
                        重置密码
                      </button>
                    )}
                    {canDeleteUser && user.id !== current?.id && (
                      <button
                        className="admin-btn admin-btn--danger"
                        onClick={() => void removeUser(user)}
                      >
                        删除
                      </button>
                    )}
                    {user.id === current?.id && (
                      <button
                        className="admin-btn"
                        onClick={() => {
                          setPasswordErrors({});
                          setPasswordOpen(true);
                        }}
                      >
                        修改密码
                      </button>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        </>
      ) : section === "roles" ? (
        <div className="user-management__role-list">
          {roles.map((role) => {
            const roleGroups = groupedPermissions
              .map((group) => ({
                ...group,
                items: role.permissions.includes("*")
                  ? group.items
                  : group.items.filter((item) =>
                      role.permissions.includes(item),
                    ),
              }))
              .filter((group) => group.items.length);
            return (
              <article className="user-management__role-row" key={role.id}>
                <div className="user-management__role-main">
                  <div>
                    <strong>{role.name}</strong>
                    {role.builtIn && <span>内置</span>}
                  </div>
                  <p>{role.description || "尚未填写角色职责说明。"}</p>
                  <details className="user-management__role-detail">
                    <summary>
                      {role.permissions.includes("*")
                        ? "查看全部系统权限说明"
                        : `查看 ${role.permissions.length} 项权限说明`}
                    </summary>
                    <div className="user-management__role-groups">
                      {roleGroups.map((group) => (
                        <section key={group.prefix}>
                          <b>{group.label}</b>
                          <ul>
                            {group.items.map((permission) => (
                              <li key={permission}>
                                <strong>
                                  {permissionMeta(permission).label}
                                </strong>
                                <span>
                                  {permissionMeta(permission).description}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </section>
                      ))}
                    </div>
                  </details>
                </div>
                <div className="user-management__permission-summary">
                  {role.permissions.includes("*")
                    ? "全部权限"
                    : `${role.permissions.length} 项权限`}
                </div>
                {!role.builtIn && (
                  <div className="user-management__actions">
                    <button
                      className="admin-btn"
                      onClick={() =>
                        setRoleDraft({
                          id: role.id,
                          name: role.name,
                          description: role.description,
                          permissions: role.permissions,
                        })
                      }
                    >
                      编辑
                    </button>
                    <button
                      className="admin-btn admin-btn--danger"
                      onClick={() => void removeRole(role)}
                    >
                      删除
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="user-management__audit">
          {logs.length ? (
            logs.map((log) => (
              <div className="user-management__audit-row" key={log.id}>
                <time>{fmt(log.createdAt)}</time>
                <strong>{log.username || "系统"}</strong>
                <span>{ACTION_LABEL[log.action] || log.action}</span>
                <code>{log.resourceId || log.resourceType}</code>
              </div>
            ))
          ) : (
            <div className="admin-empty">
              <p>暂无操作记录</p>
            </div>
          )}
        </div>
      )}

      {userDraft && (
        <AdminModalPortal className="admin-modal-overlay">
          <div
            className="admin-modal admin-modal--wide admin-modal--workflow"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="admin-modal__title admin-workflow-head">
              {userDraft.id ? "编辑管理员" : "添加管理员"}
            </h2>
            <AdminWorkflowClose onClick={() => { setUserDraft(null); setUserErrors({}); }} />
            <div className="admin-workflow-layout">
              <AdminWizardSteps
                active={userWizardStep}
                steps={[
                  { label: "账户信息", hint: "用户名、名称和角色" },
                  { label: "管理范围", hint: "年级与班级权限" },
                  { label: "确认保存", hint: "检查账户配置" },
                ]}
                summary={<><span>当前账户</span><strong>{userDraft.displayName || userDraft.username || "尚未填写"}</strong><span>{delegableRoles.find((role) => role.id === userDraft.roleId)?.name || "尚未选择角色"}</span></>}
              />
              <div className="admin-workflow-content" key={userWizardStep}>
            {userWizardStep === 0 && <div className="admin-workflow-pane">
            <div className="user-editor__grid">
              <label className="admin-label">
                用户名
                <input
                  className="admin-input"
                  disabled={!!userDraft.id}
                  value={userDraft.username}
                  onChange={(event) => {
                    setUserErrors((value) => ({ ...value, username: "" }));
                    setUserDraft(
                      (value) =>
                        value && { ...value, username: event.target.value },
                    );
                  }}
                  placeholder="如：grade3_admin"
                />
                {userErrors.username && (
                  <small className="admin-field-error">
                    {userErrors.username}
                  </small>
                )}
              </label>
              <label className="admin-label">
                显示名称
                <input
                  className="admin-input"
                  value={userDraft.displayName}
                  onChange={(event) => {
                    setUserErrors((value) => ({ ...value, displayName: "" }));
                    setUserDraft(
                      (value) =>
                        value && { ...value, displayName: event.target.value },
                    );
                  }}
                  placeholder="如：高三教务"
                />
                {userErrors.displayName && (
                  <small className="admin-field-error">
                    {userErrors.displayName}
                  </small>
                )}
              </label>
              {!userDraft.id && (
                <label className="admin-label">
                  初始密码
                  <input
                    className="admin-input"
                    type="password"
                    value={userDraft.password}
                    onChange={(event) => {
                      setUserErrors((value) => ({ ...value, password: "" }));
                      setUserDraft(
                        (value) =>
                          value && { ...value, password: event.target.value },
                      );
                    }}
                    placeholder="至少 8 位"
                  />
                  {userErrors.password && (
                    <small className="admin-field-error">
                      {userErrors.password}
                    </small>
                  )}
                </label>
              )}
              <label className="admin-label">
                角色
                <InlineSelect
                  className="admin-input"
                  value={userDraft.roleId}
                  onChange={(roleId) => {
                    setUserErrors((value) => ({ ...value, roleId: "", scopes: "" }));
                    setUserDraft(
                      (value) =>
                        value && {
                          ...value,
                          roleId,
                          gradeIds:
                            roleId === "class_admin" ? [] : value.gradeIds,
                          classIds:
                            roleId === "grade_admin" ? [] : value.classIds,
                        },
                    );
                  }}
                  options={delegableRoles.map((role) => ({ value: role.id, label: role.name }))}
                />
                {userErrors.roleId && (
                  <small className="admin-field-error">
                    {userErrors.roleId}
                  </small>
                )}
              </label>
              {userDraft.id && (
                <label className="admin-label">
                  状态
                  <InlineSelect
                    className="admin-input"
                    value={userDraft.status}
                    onChange={(status) =>
                      setUserDraft(
                        (value) =>
                          value && {
                            ...value,
                            status: status as UserDraft["status"],
                          },
                      )
                    }
                    options={[{ value: 'active', label: '启用' }, { value: 'disabled', label: '停用' }]}
                  />
                </label>
              )}
            </div>
            </div>}
            {userWizardStep === 1 && <div className="admin-workflow-pane">
            <div className="user-editor__scope">
              {canAssignAll && (
                <label className="admin-toggle-label">
                  <input
                    type="checkbox"
                    checked={
                      userDraft.allScope || userDraft.roleId === "super_admin"
                    }
                    disabled={userDraft.roleId === "super_admin"}
                    onChange={(event) =>
                      setUserDraft(
                        (value) =>
                          value && { ...value, allScope: event.target.checked },
                      )
                    }
                  />
                  管理全校数据
                </label>
              )}
              {!userDraft.allScope && userDraft.roleId !== "super_admin" && (
                <>
                  {userDraft.roleId !== "class_admin" && (
                    <>
                      <h3>可管理年级</h3>
                      <div className="admin-major-targets">
                        {visibleGrades.map((grade) => (
                          <label key={grade.id}>
                            <input
                              type="checkbox"
                              checked={userDraft.gradeIds.includes(grade.id)}
                              onChange={(event) => {
                                setUserErrors((value) => ({
                                  ...value,
                                  scopes: "",
                                }));
                                setUserDraft(
                                  (value) =>
                                    value && {
                                      ...value,
                                      gradeIds: event.target.checked
                                        ? [...value.gradeIds, grade.id]
                                        : value.gradeIds.filter(
                                            (id) => id !== grade.id,
                                          ),
                                    },
                                );
                              }}
                            />
                            {grade.name}
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                  <h3>{userDraft.roleId === "class_admin" ? "指定管理班级" : "额外指定班级"}</h3>
                  <ClassMultiPicker
                    options={classPickerOptions}
                    selectedIds={userDraft.classIds}
                    onChange={(ids) => {
                      setUserErrors((value) => ({ ...value, scopes: "" }));
                      setUserDraft(
                        (value) => value && { ...value, classIds: ids },
                      );
                    }}
                  />
                  {userErrors.scopes && (
                    <small className="admin-field-error">
                      {userErrors.scopes}
                    </small>
                  )}
                </>
              )}
            </div>
            </div>}
            {userWizardStep === 2 && <div className="admin-workflow-pane">
              <div className="admin-workflow-review">
                <span>登录用户名<strong>{userDraft.username}</strong></span>
                <span>显示名称<strong>{userDraft.displayName}</strong></span>
                <span>账户角色<strong>{delegableRoles.find((role) => role.id === userDraft.roleId)?.name || userDraft.roleId}</strong></span>
                <span>管理年级<strong>{userDraft.allScope || userDraft.roleId === "super_admin" ? "全校" : userDraft.roleId === "class_admin" ? `${new Set(userDraft.classIds.map((classId) => classes.find((item) => item.id === classId)?.gradeId).filter(Boolean)).size} 个年级` : `${userDraft.gradeIds.length} 个年级`}</strong></span>
                <span>{userDraft.roleId === "class_admin" ? "管理班级" : "额外班级"}<strong>{userDraft.allScope || userDraft.roleId === "super_admin" ? "无需单独指定" : `${userDraft.classIds.length} 个班级`}</strong></span>
                {userDraft.id && <span>账户状态<strong>{userDraft.status === "active" ? "启用" : "停用"}</strong></span>}
              </div>
              {userErrors.scopes && (
                <small className="admin-field-error">
                  {userErrors.scopes}
                </small>
              )}
            </div>}
              </div>
            </div>
            <div className="admin-modal__actions">
              <button
                className="admin-btn"
                onClick={userWizardStep === 0 ? () => { setUserDraft(null); setUserErrors({}); } : () => setUserWizardStep((value) => value - 1)}
              >
                {userWizardStep === 0 ? "取消" : "上一步"}
              </button>
              {userWizardStep < 2 ? <button className="admin-btn admin-btn--primary admin-workflow-actions-spacer" onClick={() => {
                if (userWizardStep === 0 && (!userDraft.username.trim() || !userDraft.displayName.trim() || !userDraft.roleId || (!userDraft.id && userDraft.password.length < 8))) {
                  setUserErrors((value) => ({ ...value, username: !userDraft.username.trim() ? "请填写用户名" : value.username, displayName: !userDraft.displayName.trim() ? "请填写显示名称" : value.displayName, roleId: !userDraft.roleId ? "请选择角色" : value.roleId, password: !userDraft.id && userDraft.password.length < 8 ? "初始密码至少 8 位" : value.password }));
                  return;
                }
                if (userWizardStep === 1) {
                  const scopeError = validateUserScopes(userDraft);
                  if (scopeError) {
                    setUserErrors((value) => ({ ...value, scopes: scopeError }));
                    return;
                  }
                }
                setUserWizardStep((value) => value + 1);
              }}>下一步</button> : <button className="admin-btn admin-btn--primary admin-workflow-actions-spacer" disabled={busy} onClick={() => void submitUser()}>{busy ? "保存中…" : "保存管理员"}</button>}
            </div>
          </div>
        </AdminModalPortal>
      )}
      {roleDraft && (
        <AdminModalPortal className="admin-modal-overlay">
          <div
            className="admin-modal admin-modal--wide admin-modal--workflow"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="admin-modal__title admin-workflow-head">
              {roleDraft.id ? "编辑自定义角色" : "新建自定义角色"}
            </h2>
            <AdminWorkflowClose onClick={() => setRoleDraft(null)} />
            <div className="admin-workflow-layout">
              <AdminWizardSteps
                active={roleWizardStep}
                steps={[
                  { label: "角色信息", hint: "名称和职责说明" },
                  { label: "模块权限", hint: "按模块选择权限级别" },
                  { label: "确认保存", hint: "检查角色能力" },
                ]}
                summary={<><span>当前角色</span><strong>{roleDraft.name || "尚未命名"}</strong><span>{ROLE_MODULES.filter((module) => moduleLevel(roleDraft.permissions, module) !== "none").length} 个可访问模块</span></>}
              />
              <div className="admin-workflow-content" key={roleWizardStep}>
            {roleWizardStep === 0 && <div className="admin-workflow-pane">
            <label className="admin-label">
              角色名称
              <input
                className="admin-input"
                value={roleDraft.name}
                onChange={(event) =>
                  setRoleDraft(
                    (value) => value && { ...value, name: event.target.value },
                  )
                }
              />
            </label>
            <label className="admin-label">
              角色职责说明
              <textarea
                className="admin-textarea"
                rows={2}
                value={roleDraft.description}
                onChange={(event) =>
                  setRoleDraft(
                    (value) =>
                      value && { ...value, description: event.target.value },
                  )
                }
                placeholder="说明该角色负责什么、不能做什么，分配账号时会直接展示。"
              />
            </label>
            </div>}
            {roleWizardStep === 1 && <div className="admin-workflow-pane">
            <div className="role-editor__modules">
              {ROLE_MODULES.map((module) => (
                <label key={module.id}>
                  <span>
                    <strong>{module.label}</strong>
                    <small>
                      {module.manage.length
                        ? "选择查看或管理整个模块"
                        : "控制是否显示该模块"}
                    </small>
                  </span>
                  <InlineSelect
                    className="admin-input"
                    value={moduleLevel(roleDraft.permissions, module)}
                    onChange={(value) =>
                      setRoleModuleLevel(
                        module,
                        value as RoleLevel,
                      )
                    }
                    options={[{ value: 'none', label: '不可访问' }, { value: 'read', label: '仅查看' }, ...(module.manage.length > 0 ? [{ value: 'manage', label: '可管理' }] : [])]}
                  />
                </label>
              ))}
            </div>
            <p className="admin-major-card__hint">
              数据库重置、初始化、角色管理、部署和超级管理员操作仅保留给超级管理员。
            </p>
            </div>}
            {roleWizardStep === 2 && <div className="admin-workflow-pane">
              <div className="admin-workflow-review">
                <span>角色名称<strong>{roleDraft.name || "未填写"}</strong></span>
                <span>职责说明<strong>{roleDraft.description || "未填写"}</strong></span>
                {ROLE_MODULES.map((module) => <span key={module.id}>{module.label}<strong>{moduleLevel(roleDraft.permissions, module) === "manage" ? "可管理" : moduleLevel(roleDraft.permissions, module) === "read" ? "仅查看" : "不可访问"}</strong></span>)}
              </div>
            </div>}
              </div>
            </div>
            <div className="admin-modal__actions">
              <button
                className="admin-btn"
                onClick={roleWizardStep === 0 ? () => setRoleDraft(null) : () => setRoleWizardStep((value) => value - 1)}
              >
                {roleWizardStep === 0 ? "取消" : "上一步"}
              </button>
              {roleWizardStep < 2 ? <button className="admin-btn admin-btn--primary admin-workflow-actions-spacer" onClick={() => { if (roleWizardStep === 0 && !roleDraft.name.trim()) return; setRoleWizardStep((value) => value + 1); }}>下一步</button> : <button className="admin-btn admin-btn--primary admin-workflow-actions-spacer" disabled={busy} onClick={() => void submitRole()}>{busy ? "保存中…" : "保存角色"}</button>}
            </div>
          </div>
        </AdminModalPortal>
      )}
      {resetTarget && (
        <AdminModalPortal className="admin-modal-overlay">
          <div
            className="admin-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="admin-modal__title">
              重置 {resetTarget.displayName} 的密码
            </h2>
            <p className="admin-modal__body">
              重置后该用户当前登录立即失效，下次登录必须再次修改用户名和密码。
            </p>
            <div className="user-management__reset-modes">
              <button
                className={resetMode === "generated" ? "is-active" : ""}
                onClick={() => {
                  setResetMode("generated");
                  setResetPassword(generateTemporaryPassword());
                  setResetError("");
                }}
              >
                自动生成临时密码
              </button>
              <button
                className={resetMode === "manual" ? "is-active" : ""}
                onClick={() => {
                  setResetMode("manual");
                  setResetPassword("");
                  setResetError("");
                }}
              >
                手动设置
              </button>
            </div>
            {resetError && <div className="admin-error">{resetError}</div>}
            <label className="admin-label">
              临时密码
              <input
                className="admin-input"
                type={resetMode === "manual" ? "password" : "text"}
                value={resetPassword}
                onChange={(event) => {
                  setResetPassword(event.target.value);
                  setResetError("");
                }}
                placeholder="新密码，至少 8 位"
              />
            </label>
            {resetMode === "generated" && (
              <button
                className="admin-btn user-management__regenerate"
                onClick={() => setResetPassword(generateTemporaryPassword())}
              >
                重新生成
              </button>
            )}
            <div className="admin-modal__actions">
              <button
                className="admin-btn admin-btn--primary"
                disabled={busy}
                onClick={() => void submitReset()}
              >
                {busy ? "正在重置…" : "确认重置"}
              </button>
              <button
                className="admin-btn"
                onClick={() => {
                  setResetTarget(null);
                  setResetPassword("");
                  setResetError("");
                }}
              >
                取消
              </button>
            </div>
          </div>
        </AdminModalPortal>
      )}
      {issuedPassword && (
        <AdminModalPortal className="admin-modal-overlay">
          <div
            className="admin-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="admin-modal__title">临时密码已创建</h2>
            <p className="admin-modal__body">
              请立即交给 {issuedPassword.displayName}
              。关闭后系统不会再次显示这段密码。
            </p>
            <div className="user-management__issued-password">
              <code>{issuedPassword.password}</code>
              <button
                className="admin-btn admin-btn--primary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      issuedPassword.password,
                    );
                    setCopyStatus("已复制");
                  } catch {
                    setCopyStatus("复制失败，请手动复制");
                  }
                }}
              >
                复制
              </button>
            </div>
            {copyStatus && (
              <p className="admin-field-hint" aria-live="polite">
                {copyStatus}
              </p>
            )}
            <div className="admin-modal__actions">
              <button
                className="admin-btn"
                onClick={() => {
                  setIssuedPassword(null);
                  setCopyStatus("");
                }}
              >
                我已妥善保存
              </button>
            </div>
          </div>
        </AdminModalPortal>
      )}
      {passwordOpen && (
        <AdminModalPortal className="admin-modal-overlay">
          <div
            className="admin-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="admin-modal__title">
              {forcePasswordChange || current?.mustChangePassword
                ? "设置我的账户信息"
                : "修改我的密码"}
            </h2>
            <p className="admin-modal__body">
              账户信息保存在当前部署的 Neon
              数据库。修改成功后所有旧会话会失效，需要使用新用户名和密码重新登录。
            </p>
            <div className="user-management__password-fields">
              {(forcePasswordChange || current?.mustChangePassword) && (
                <label className="admin-label">
                  新登录用户名
                  <input
                    className="admin-input"
                    autoComplete="username"
                    value={passwordDraft.username}
                    onChange={(event) => {
                      setPasswordErrors((value) => ({
                        ...value,
                        username: "",
                      }));
                      setPasswordDraft((value) => ({
                        ...value,
                        username: event.target.value,
                      }));
                    }}
                    placeholder="3-40 位字母、数字、点、横线或下划线"
                  />
                  {passwordErrors.username && (
                    <small className="admin-field-error">
                      {passwordErrors.username}
                    </small>
                  )}
                </label>
              )}
              <label className="admin-label">
                当前密码
                <input
                  className="admin-input"
                  type="password"
                  autoComplete="current-password"
                  value={passwordDraft.current}
                  onChange={(event) => {
                    setPasswordErrors((value) => ({ ...value, current: "" }));
                    setPasswordDraft((value) => ({
                      ...value,
                      current: event.target.value,
                    }));
                  }}
                />
                {passwordErrors.current && (
                  <small className="admin-field-error">
                    {passwordErrors.current}
                  </small>
                )}
              </label>
              <label className="admin-label">
                新密码
                <input
                  className="admin-input"
                  type="password"
                  autoComplete="new-password"
                  value={passwordDraft.next}
                  onChange={(event) => {
                    setPasswordErrors((value) => ({ ...value, next: "" }));
                    setPasswordDraft((value) => ({
                      ...value,
                      next: event.target.value,
                    }));
                  }}
                  placeholder="至少 8 位"
                />
                {passwordErrors.next && (
                  <small className="admin-field-error">
                    {passwordErrors.next}
                  </small>
                )}
              </label>
              <label className="admin-label">
                确认新密码
                <input
                  className="admin-input"
                  type="password"
                  autoComplete="new-password"
                  value={passwordDraft.confirm}
                  onChange={(event) => {
                    setPasswordErrors((value) => ({ ...value, confirm: "" }));
                    setPasswordDraft((value) => ({
                      ...value,
                      confirm: event.target.value,
                    }));
                  }}
                />
                {passwordErrors.confirm && (
                  <small className="admin-field-error">
                    {passwordErrors.confirm}
                  </small>
                )}
              </label>
            </div>
            <div className="admin-modal__actions">
              <button
                className="admin-btn admin-btn--primary"
                disabled={busy}
                onClick={() => void submitOwnPassword()}
              >
                {busy ? "保存中…" : "保存并重新登录"}
              </button>
              {!forcePasswordChange && !current?.mustChangePassword && (
                <button
                  className="admin-btn"
                  onClick={() => {
                    setPasswordOpen(false);
                    setPasswordErrors({});
                  }}
                >
                  取消
                </button>
              )}
            </div>
          </div>
        </AdminModalPortal>
      )}
      {usernameOpen && (
        <AdminModalPortal className="admin-modal-overlay">
          <div
            className="admin-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="admin-modal__title">修改我的用户名</h2>
            <p className="admin-modal__body">
              修改后所有旧会话都会失效，需要使用新用户名重新登录。
            </p>
            {usernameError && (
              <div className="admin-error">{usernameError}</div>
            )}
            <div className="user-management__password-fields">
              <label className="admin-label">
                新登录用户名
                <input
                  className="admin-input"
                  autoComplete="username"
                  value={usernameDraft.username}
                  onChange={(event) => {
                    setUsernameError("");
                    setUsernameDraft((value) => ({
                      ...value,
                      username: event.target.value,
                    }));
                  }}
                />
              </label>
              <label className="admin-label">
                验证当前身份
                <input
                  className="admin-input"
                  type="password"
                  autoComplete="current-password"
                  value={usernameDraft.currentPassword}
                  onChange={(event) => {
                    setUsernameError("");
                    setUsernameDraft((value) => ({
                      ...value,
                      currentPassword: event.target.value,
                    }));
                  }}
                  placeholder="请输入当前登录密码"
                />
                <small className="admin-field-hint">
                  仅用于验证操作者身份，不会修改当前密码。
                </small>
              </label>
            </div>
            <div className="admin-modal__actions">
              <button
                className="admin-btn admin-btn--primary"
                disabled={busy}
                onClick={() => void submitOwnUsername()}
              >
                {busy ? "验证中…" : "验证并修改用户名"}
              </button>
              <button
                className="admin-btn"
                onClick={() => {
                  setUsernameOpen(false);
                  setUsernameError("");
                }}
              >
                取消
              </button>
            </div>
          </div>
        </AdminModalPortal>
      )}
    </main>
  );
}
