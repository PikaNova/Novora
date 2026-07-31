/**
 * 权限判断的唯一实现。前端（src/services/examService.ts）与后端
 * （api/_auth.ts、api/exams.ts）都从这里导入，避免同一套判断逻辑
 * 分别维护三份、随时间产生漂移（例如年级范围判断曾经历史上不完全一致）。
 *
 * 本文件不依赖浏览器（window/localStorage/document）或 Node 专属 API，
 * 因此可以被 Vite 前端打包与 Vercel serverless 函数同时安全导入。
 */

export const ALL_PERMISSIONS = [
	'overview.read',
	'major.read', 'major.create', 'major.quick_create', 'major.edit', 'major.delete', 'major.import', 'major.export',
	'weekly.read', 'weekly.create', 'weekly.edit', 'weekly.delete', 'weekly.copy', 'weekly.override', 'weekly.import', 'weekly.export',
	'school.read', 'school.grade_manage', 'school.class_manage',
	'device.read', 'device.bind', 'device.revoke',
	'schedule.mode_edit', 'schedule.conflict_edit', 'schedule.term_edit', 'schedule.ab_week_edit', 'schedule.holiday_edit',
	'alerts.read', 'alerts.edit', 'settings.read', 'settings.edit', 'settings.major_batch_edit', 'initialization.run', 'demo_data.delete',
	'user.read', 'user.create', 'user.edit', 'user.disable', 'user.delete', 'user.reset_password', 'role.manage', 'audit.read', 'deployment.trigger',
] as const;

export type Permission = typeof ALL_PERMISSIONS[number] | '*';

export type PermissionScope = { type: 'all' | 'grade' | 'class'; gradeId: string; classId: string };

/** 后端 AdminActor 与前端 AdminUserContext 的最小公共形状，只包含权限判断需要的字段。 */
export type PermissionSubject = {
	permissions: readonly string[];
	scopes: readonly PermissionScope[];
};

/** 是否拥有某项具体权限（含通配符 `*`）。 */
export function hasPermission(subject: PermissionSubject | null | undefined, permission: Permission | string): boolean {
	if (!subject) return false;
	return subject.permissions.includes('*') || subject.permissions.includes(permission as string);
}

/** 是否拥有全校范围授权（用于「仅全校管理员可操作」的场景，如切换运行模式、增删年级）。 */
export function hasAllScope(subject: PermissionSubject | null | undefined): boolean {
	if (!subject) return false;
	return subject.permissions.includes('*') || subject.scopes.some(scope => scope.type === 'all');
}

/** 是否可以管理指定年级（全校范围，或该年级本身的年级/班级授权）。 */
export function canAccessGrade(subject: PermissionSubject | null | undefined, gradeId: string): boolean {
	if (!subject) return false;
	if (hasAllScope(subject)) return true;
	return subject.scopes.some(scope => (scope.type === 'grade' || scope.type === 'class') && scope.gradeId === gradeId);
}

/** 是否可以管理指定班级（全校范围、该年级授权、或该班级授权均可）。 */
export function canAccessClass(subject: PermissionSubject | null | undefined, gradeId: string, classId: string): boolean {
	if (!subject) return false;
	if (hasAllScope(subject)) return true;
	return subject.scopes.some(scope => (scope.type === 'grade' && scope.gradeId === gradeId) || (scope.type === 'class' && scope.classId === classId));
}
