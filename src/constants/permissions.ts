/**
 * 管理后台的权限展示元数据（模块划分、分组、每项权限的中文说明、审计日志动作文案）。
 * 从 src/components/UserManagementPanel.tsx 中提取，使其可以被其他管理页面
 * （如 AdminPage.tsx）复用，而不必重复定义一份相同的数据。
 *
 * 注意：这里只是“展示用”的元数据，真正的权限判断逻辑在 src/shared/permissionRules.ts。
 */

export type RoleLevel = "none" | "read" | "manage";

export type RoleModule = {
	id: string;
	label: string;
	read: string[];
	manage: string[];
};

export const ROLE_MODULES: RoleModule[] = [
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
		manage: ["alerts.edit", "schedule.mode_edit", "schedule.conflict_edit"],
	},
];

export const moduleLevel = (
	permissions: string[],
	module: RoleModule,
): RoleLevel =>
	module.manage.some((item) => permissions.includes(item))
		? "manage"
		: module.read.some((item) => permissions.includes(item))
			? "read"
			: "none";

export const PERMISSION_GROUPS: Array<{ prefix: string; label: string }> = [
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

export const PERMISSION_META: Record<string, { label: string; description: string }> = {
	"overview.read": { label: "查看管理概览", description: "进入管理后台并查看基础运行状态。" },
	"major.read": { label: "查看大型考试", description: "查看授权范围内的大型考试及科目安排。" },
	"major.create": { label: "新建大型考试", description: "创建新的大型考试计划。" },
	"major.quick_create": { label: "快速发布班级考试", description: "为授权班级快速发布一场临时考试，不可发布全校或年级统一考试。" },
	"major.edit": { label: "编辑大型考试", description: "修改考试名称、适用年级和科目时间。" },
	"major.delete": { label: "删除大型考试", description: "删除已有大型考试计划。" },
	"major.import": { label: "导入大型考试", description: "通过 JSON 批量导入考试安排。" },
	"major.export": { label: "导出大型考试", description: "导出当前考试安排用于备份或复用。" },
	"weekly.read": { label: "查看周测", description: "查看授权班级的周测计划和日历。" },
	"weekly.create": { label: "新建周测", description: "为班级创建新的周测计划。" },
	"weekly.edit": { label: "编辑周测", description: "修改周测科目、时间和 A/B 周设置。" },
	"weekly.delete": { label: "删除周测", description: "删除已有周测计划。" },
	"weekly.copy": { label: "复制周测计划", description: "将一个计划批量应用到其他班级。" },
	"weekly.override": { label: "处理周测例外", description: "设置单日停用、补测或冲突覆盖。" },
	"weekly.import": { label: "导入周测", description: "批量导入周测计划。" },
	"weekly.export": { label: "导出周测", description: "导出周测计划用于备份。" },
	"school.read": { label: "查看年级班级", description: "查看学校年级和班级结构。" },
	"school.grade_manage": { label: "管理年级", description: "新增或删除年级。" },
	"school.class_manage": { label: "管理班级", description: "新增、调整或删除班级。" },
	"device.read": { label: "查看设备", description: "查看客户端绑定和当前运行状态。" },
	"device.bind": { label: "绑定设备", description: "将客户端绑定到指定年级和班级。" },
	"device.revoke": { label: "删除设备", description: "撤销设备实例并要求客户端重新绑定。" },
	"schedule.mode_edit": { label: "修改运行模式", description: "切换大型考试、周测或自动调度模式。" },
	"schedule.conflict_edit": { label: "修改冲突规则", description: "设置大型考试与周测发生冲突时的处理方式。" },
	"alerts.read": { label: "查看提醒", description: "查看全屏提醒与自定义提醒配置。" },
	"alerts.edit": { label: "编辑提醒", description: "修改提醒内容、时间和启停状态。" },
	"settings.read": { label: "查看系统设置", description: "查看校时、显示、字体和版本信息。" },
	"settings.edit": { label: "编辑系统设置", description: "修改系统级显示和运行参数。" },
	"initialization.run": { label: "运行初始化向导", description: "重新配置学校结构和初始数据。" },
	"demo_data.delete": { label: "清除演示数据", description: "删除初始化向导导入的测试内容。" },
	"user.read": { label: "查看管理员", description: "查看管理员账号、角色和数据范围。" },
	"user.create": { label: "创建管理员", description: "新增客户端管理员账号。" },
	"user.edit": { label: "编辑管理员", description: "修改显示名称、角色、状态和数据范围。" },
	"user.disable": { label: "启停管理员", description: "停用或重新启用管理员账号。" },
	"user.reset_password": { label: "重置他人密码", description: "为可管理的账号设置临时密码并使旧会话失效。" },
	"user.delete": { label: "删除管理员", description: "删除管理范围内的账号并立即撤销其所有会话。" },
	"role.manage": { label: "管理角色", description: "创建、修改和删除自定义角色。" },
	"audit.read": { label: "查看操作日志", description: "查看最近的登录与数据修改记录。" },
	"deployment.trigger": { label: "触发重新部署", description: "通过已配置的部署钩子更新应用。" },
};

export const ACTION_LABEL: Record<string, string> = {
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

export const permissionMeta = (permission: string) =>
	PERMISSION_META[permission] ?? {
		label: permission,
		description: "自定义系统权限。",
	};
