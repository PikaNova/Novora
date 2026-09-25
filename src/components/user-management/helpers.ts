import type { SchoolClass, SchoolGrade } from '../../types/school';
import type { AdminScope } from '../../services/examService';
import type { ManagedUser } from '../../services/adminUsers';
import { AdminApiError } from '../../services/adminUsers';
import type { UserDraft } from './types';

export type RoutedAdminError = {
  /** 落到哪个字段；`_form` 表示表单级（弹窗顶部）。 */
  field: string;
  message: string;
  formLevel: boolean;
};

/**
 * 把接口错误路由到该显示的位置。
 *
 * 以前只有 `error.field` 存在时才显示在弹窗里，其余全部写进面板横幅——而横幅被弹窗遮罩
 * 盖着，等于用户什么也看不到（"保存没反应、库里也没变"）。现在没有字段的错误统一按
 * `_form` 处理，由弹窗自己在顶部显示。
 */
export function routeAdminApiError(error: unknown, fallback = '保存失败'): RoutedAdminError {
  const message = error instanceof Error && error.message ? error.message : fallback;
  const field = error instanceof AdminApiError && error.field ? error.field : '_form';
  return { field, message, formLevel: field === '_form' };
}

export const fmt = (value?: number | null) =>
  value ? new Date(Number(value)).toLocaleString('zh-CN', { hour12: false }) : '从未登录';

export const generateTemporaryPassword = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const values = new Uint32Array(14);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join('');
};

export function scopeText(user: ManagedUser, grades: SchoolGrade[], classes: SchoolClass[]) {
  if (user.scopes.some((scope) => scope.type === 'all')) return '全校';
  const names = user.scopes.map((scope) =>
    scope.type === 'grade'
      ? grades.find((item) => item.id === scope.gradeId)?.name
      : `${grades.find((item) => item.id === scope.gradeId)?.name ?? '未知年级'} · ${classes.find((item) => item.id === scope.classId)?.name ?? '未知班级'}`,
  );
  return names.filter(Boolean).join('、') || '未分配范围';
}

export function draftScopes(draft: UserDraft, classes: SchoolClass[]): AdminScope[] {
  if (draft.allScope) return [{ type: 'all', gradeId: '', classId: '' }];
  if (draft.roleId === 'class_admin') {
    return draft.classIds.map((classId) => ({
      type: 'class' as const,
      gradeId: classes.find((item) => item.id === classId)?.gradeId ?? '',
      classId,
    }));
  }
  return [
    ...draft.gradeIds.map((gradeId) => ({
      type: 'grade' as const,
      gradeId,
      classId: '',
    })),
    ...draft.classIds.map((classId) => ({
      type: 'class' as const,
      gradeId: classes.find((item) => item.id === classId)?.gradeId ?? '',
      classId,
    })),
  ];
}

export function validateUserDraftFields(draft: UserDraft) {
  const errors: Record<string, string> = {};
  if (!draft.id && !/^[A-Za-z0-9._-]{3,40}$/.test(draft.username.trim()))
    errors.username = '请输入 3-40 位字母、数字、点、横线或下划线';
  if (!draft.displayName.trim()) errors.displayName = '请输入显示名称';
  if (!draft.id && draft.password.length < 8) errors.password = '初始密码至少需要 8 位';
  if (!draft.roleId) errors.roleId = '请选择角色';
  return errors;
}
export function validateUserScopes(draft: UserDraft) {
  if (draft.roleId === 'super_admin' || draft.allScope) return '';
  if (draft.roleId === 'class_admin' && !draft.classIds.length) return '班级管理员必须选择至少一个具体班级';
  if (draft.roleId === 'grade_admin' && !draft.gradeIds.length) return '年级管理员必须选择至少一个年级';
  if (!draft.gradeIds.length && !draft.classIds.length) return '至少选择一个年级或班级';
  return '';
}
