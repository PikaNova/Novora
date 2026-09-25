// api/_auth/roles.ts
// 内置角色与权限清单的解析。角色文案/授权范围的调整只动这一个文件。
import { ALL_PERMISSIONS, type Permission } from '../../src/shared/permissionRules.js';

export const BUILTIN_ROLES: Array<{ id: string; name: string; description: string; permissions: Permission[] }> = [
  {
    id: 'super_admin',
    name: '超级管理员',
    description: '拥有全校数据与全部系统权限，可管理用户、角色、部署及所有业务设置。',
    permissions: ['*'],
  },
  {
    id: 'grade_admin',
    name: '年级管理员',
    description:
      '管理授权年级的考试、周测、班级、设备和下级用户，可批量创建该年级的班级管理员，并查看该年级完整运行总览。',
    permissions: [
      'overview.read',
      'major.read',
      'major.create',
      'major.quick_create',
      'major.edit',
      'major.delete',
      'major.import',
      'major.export',
      'weekly.read',
      'weekly.create',
      'weekly.edit',
      'weekly.delete',
      'weekly.copy',
      'weekly.override',
      'weekly.import',
      'weekly.export',
      'school.read',
      'school.class_manage',
      'device.read',
      'device.bind',
      'device.revoke',
      'alerts.read',
      'settings.read',
      'user.read',
      'user.create',
      'user.edit',
      'user.disable',
      'user.delete',
      'user.reset_password',
    ],
  },
  {
    id: 'class_admin',
    name: '班级管理员',
    description:
      '管理授权班级的周测、考试安排和绑定设备，可快速发布本班临时考试并修改自己的用户名与密码，不显示项目运行总览。',
    permissions: [
      'major.read',
      'major.quick_create',
      'weekly.read',
      'weekly.create',
      'weekly.edit',
      'weekly.delete',
      'weekly.copy',
      'weekly.override',
      'weekly.import',
      'weekly.export',
      'school.read',
      'device.read',
      'device.bind',
      'device.revoke',
      'alerts.read',
    ],
  },
  {
    id: 'viewer',
    name: '班级访客',
    description: '未登录设备可查看本班考试安排、周测与教室大屏，可导出核对，不修改任何数据。',
    permissions: [
      'major.read',
      'major.export',
      'weekly.read',
      'weekly.export',
      'school.read',
      'device.read',
      'alerts.read',
      'settings.read',
    ],
  },
];

export function parsePermissions(value: unknown): Permission[] {
  if (!Array.isArray(value)) return [];
  const known = new Set<string>(ALL_PERMISSIONS as readonly string[]);
  return value.filter((item): item is Permission => item === '*' || (typeof item === 'string' && known.has(item)));
}
