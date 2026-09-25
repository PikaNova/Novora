/**
 * 审计日志（`app_audit_logs`）里动作与资源的中文名。
 *
 * 起因：学校管理员会自己看「用户管理 → 操作日志」和「设置 → 系统状态 → 最近系统事件」，
 * 但服务端写入的是 `auth.email.code`、`device.command.pause` 这类机器码，过去没有中文名
 * 就直接印在界面上，用户看不懂。这里把中文名收成唯一数据源：
 *
 * - 界面一律显示中文，原始码只作为 `title` 悬停提示保留给排查用；
 * - 认不出来的动作显示「未识别的操作」，不再裸显英文码；
 * - `tests/auditActionLabels.test.ts` 扫描 `api/**` 的 `writeAudit` 字面量做防回归，
 *   新增动作忘了配中文名会直接测试失败。
 */

/** 兜底文案：带上原始码就又是英文了，所以这里不带。 */
export const UNKNOWN_AUDIT_ACTION_LABEL = '未识别的操作';

/**
 * 动作全名 → 中文名。服务端 `writeAudit(actor, action, ...)` 的 action 必须在这里能查到。
 */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  // 登录与账号
  'auth.login': '登录后台',
  'auth.guest.login': '教室设备登录',
  'auth.email.code': '发送邮箱验证码',
  'auth.email.code.queued': '邮箱验证码已排入发送队列',
  'auth.email.login': '邮箱验证码登录',
  'auth.email.bind.request': '申请绑定邮箱',
  'auth.email.bind.request.queued': '邮箱绑定验证码已排入发送队列',
  'auth.email.bind.confirm': '完成邮箱绑定',
  'auth.email.unbind': '解除邮箱绑定',
  'user.create': '创建管理员',
  'user.update': '修改管理员',
  'user.delete': '删除管理员',
  'user.credentials.change': '修改自己的账号凭据',
  'user.username.change': '修改登录用户名',
  'user.password.change': '修改自己的密码',
  'user.password.reset': '重置他人密码',
  'user.password.recover': '找回账号密码',
  'user.super_admin.repair': '修复超级管理员账号',
  'user.super_admin.repair.failed': '修复超级管理员失败',
  'role.create': '创建角色',
  'role.update': '修改角色',
  'role.delete': '删除角色',

  // 邮件服务配置
  'email.config.save': '保存邮件服务配置',
  'email.config.clear': '清空邮件服务配置',

  // 教室设备
  'device.setup': '绑定教室设备',
  'device.role.management': '把设备设为管理端',
  'device.role.class-terminal': '把设备设为班级终端',
  'device.revoke': '删除设备绑定',

  // 考试与设置
  'exam-data.update': '修改考试数据',
  'exam.announcement.send': '发送考试公告',
  'exam.announcement.revoke': '撤回考试公告',
  'exam.announcement.remind': '提醒未读教室',
  'exam.announcement.template_save': '把公告存为模板',
  'settings.design-policy': '保存表格显示规则',
  'settings.major-batch-presets': '保存批量考试预设',

  // 运维
  'database.reset': '重置数据库数据',
  'deployment.trigger': '触发重新部署',
  'diagnostics.settings.update': '修改诊断日志设置',
  'diagnostics.bundle.send': '上传诊断日志包',
};

/**
 * 「一族」动作：服务端用 `device.command.${action}` / `exam.record.${action}` 拼出来的。
 * 后缀表同时也是口径说明，新增后缀要同步 tests/auditActionLabels.test.ts。
 */
const ACTION_FAMILIES: Array<{
  prefix: string;
  /** 后缀认不出来时的族名，保证仍然是中文。 */
  fallback: string;
  suffix: Record<string, string>;
}> = [
  {
    prefix: 'device.command.',
    fallback: '下发设备指令',
    suffix: {
      pause: '下发设备指令：暂停考试',
      resume: '下发设备指令：继续考试',
      extend: '下发设备指令：延长考试',
      end: '下发设备指令：结束考试',
    },
  },
  {
    prefix: 'exam.record.',
    fallback: '考试记录操作',
    suffix: {
      publish: '发布考试',
      pause: '暂停考试',
      resume: '继续考试',
      extend: '延长考试',
      end: '结束考试',
      request_stop: '申请停止考试',
      force_end: '强制结束考试',
      archive: '归档考试',
      unarchive: '取消归档考试',
      copy: '复制考试',
    },
  },
];

/** 动作码 → 中文名。永远不返回原始英文码。 */
export function auditActionLabel(action: unknown): string {
  const key = typeof action === 'string' ? action.trim() : '';
  if (!key) return UNKNOWN_AUDIT_ACTION_LABEL;
  const exact = AUDIT_ACTION_LABEL[key];
  if (exact) return exact;
  for (const family of ACTION_FAMILIES) {
    if (!key.startsWith(family.prefix)) continue;
    const suffix = key.slice(family.prefix.length);
    return family.suffix[suffix] ?? family.fallback;
  }
  return UNKNOWN_AUDIT_ACTION_LABEL;
}

/** 资源类型 → 中文名。认不出来时返回空串，由调用方决定退化成什么。 */
export const AUDIT_RESOURCE_LABEL: Record<string, string> = {
  user: '管理员账号',
  role: '角色权限',
  device: '教室设备',
  exam_data: '考试数据',
  exam_record: '考试记录',
  exam_announcement: '考试公告',
  exam_announcement_template: '公告模板',
  diagnostics: '诊断日志',
  settings: '系统设置',
  deployment: '部署与更新',
};

export function auditResourceLabel(resourceType: unknown): string {
  const key = typeof resourceType === 'string' ? resourceType.trim() : '';
  return key ? (AUDIT_RESOURCE_LABEL[key] ?? '') : '';
}

/**
 * 资源 ID 在列表里只是「哪一条」的指针：uuid 全量显示会撑破手机端表格，
 * 这里统一截断，完整值由调用方放进 title 悬停查看。
 */
export function shortResourceId(resourceId: unknown, max = 10): string {
  const key = typeof resourceId === 'string' ? resourceId.trim() : '';
  if (!key) return '';
  return key.length > max ? `${key.slice(0, max)}…` : key;
}

/** 操作日志里「资源」那一格：类型 + 短 ID，两者都没有时显示占位符。 */
export function auditResourceText(resourceType: unknown, resourceId: unknown): string {
  const parts = [auditResourceLabel(resourceType), shortResourceId(resourceId)].filter(Boolean);
  return parts.length ? parts.join(' ') : '—';
}
