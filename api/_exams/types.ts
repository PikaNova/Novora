// api/_exams/types.ts
// 数据行类型定义：从原 api/exams.ts 抽出，供 payload/diff/permissions/handler 各子模块共享。

export type ExamRow = {
  items?: unknown;
  title?: string;
  majors?: unknown;
  active_major_id?: string;
  alerts?: unknown;
  weekly_plans?: unknown;
  schedule_mode?: string;
  active_weekly_plan_id?: string;
  active_weekly_plan_by_class?: unknown;
  weekly_conflict_policy?: unknown;
  grades?: unknown;
  classes?: unknown;
  initialization?: unknown;
  design_policy?: unknown;
  major_batch_presets?: unknown;
  exam_metadata?: unknown;
  lifecycle?: unknown;
  /** 域级修订号（v2.8.8）：`{ major: 3, weekly: 7, ... }`，用于按域判定并发冲突。 */
  revisions?: unknown;
  updated_at?: number | string | null;
  bound_grade_id?: string | null;
  bound_class_id?: string | null;
  binding_revoked?: boolean | null;
  binding_is_management?: boolean | null;
};

export type UpdatedRow = { updated_at: number | string; revisions?: unknown };

export type PluginInstanceRow = {
  plugin_instance_id: string;
  client_secret_hash: string;
  pair_token_hash?: string | null;
  pair_expires_at?: number | string | null;
  grade_id?: string | null;
  class_id?: string | null;
  viewer_instance_id?: string | null;
  paired?: boolean | null;
  viewer_last_seen_at?: number | string | null;
};
