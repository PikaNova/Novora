export function buildSeoTitle(schoolName: string, titleSuffix: string): string | null {
  const suffix = titleSuffix || '考试看板';
  return schoolName ? schoolName + ' · ' + suffix : null;
}

export const SEO_FALLBACK_DESCRIPTION =
  'Novora 为学校提供考试安排、周测计划、临时考试与教室大屏管理能力，支持多角色权限、班级端同步、考试提醒和本地或云端部署。';

export function buildSeoDescription(schoolName: string, description: string): string {
  return description || (schoolName ? schoolName + '考试安排与教室大屏管理平台' : SEO_FALLBACK_DESCRIPTION);
}
