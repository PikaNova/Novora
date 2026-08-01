// api/_exams/permissions.ts
// 鉴权校验：validateMutation 与 allScope。从原 api/exams.ts 抽出，保持单一职责。
// 权限判断逻辑统一来自 src/shared/permissionRules.ts，与 api/_auth.ts、src/services/examService.ts 保持一致。

import {
  canAccessClass,
  canAccessGrade,
  hasPermission,
  type AdminActor,
  type Permission,
} from "../_auth.js";
import { hasAllScope as sharedHasAllScope } from "../../src/shared/permissionRules.js";
import {
  changedRecords,
  cleanActiveWeeklyPlanByClass,
  recordDiff,
  sameJson,
} from "./diff.js";
import type { ExamPayload } from "./payload.js";

export const allScope = (actor: AdminActor) => sharedHasAllScope(actor);

export function isolateQuickMajorCreate(
  actor: AdminActor,
  current: ExamPayload,
  body: Record<string, any>,
): Record<string, any> {
  if (
    hasPermission(actor, "major.create") ||
    !hasPermission(actor, "major.quick_create") ||
    !Array.isArray(body.majors)
  )
    return body;

  const activeMajorId = String(body.activeMajorId ?? "");
  const activeMajor = body.majors.find(
    (major: any) => String(major?.id ?? "") === activeMajorId,
  );
  const alreadyExists = (current.majors as any[]).some(
    (major) => String(major?.id ?? "") === activeMajorId,
  );
  const ownsNewClassQuickMajor =
    activeMajor &&
    !alreadyExists &&
    activeMajor.source === "quick" &&
    activeMajor.temporary === true &&
    activeMajor.createdBy === actor.id &&
    Array.isArray(activeMajor.targetClassIds) &&
    activeMajor.targetClassIds.length > 0;

  if (!ownsNewClassQuickMajor) return body;

  // Class administrators post a full local snapshot. Keep only the new
  // class-scoped quick major so stale records cannot alter the server payload.
  return {
    ...body,
    majors: [...current.majors, activeMajor],
    items: Array.isArray(activeMajor.items) ? activeMajor.items : [],
    title: typeof activeMajor.name === "string" ? activeMajor.name : "",
    activeMajorId,
  };
}

export function validateMutation(
  actor: AdminActor,
  current: ExamPayload,
  body: Record<string, any>,
):
  | { ok: true; actions: string[] }
  | { ok: false; error: string; permission?: Permission } {
  const actions: string[] = [];
  const need = (permission: Permission, label: string) => {
    if (!hasPermission(actor, permission))
      return {
        ok: false as const,
        error: `当前账号无权修改${label}`,
        permission,
      };
    actions.push(permission);
    return null;
  };
  const isOwnedQuickTemporaryMajor = (major: unknown) => {
    if (!major || typeof major !== "object") return false;
    const value = major as Record<string, unknown>;
    return value.source === "quick" && value.temporary === true && value.createdBy === actor.id;
  };
  const needEither = (
    primary: Permission,
    alternative: Permission,
    label: string,
    allowAlternative: boolean,
  ) => {
    if (hasPermission(actor, primary)) {
      actions.push(primary);
      return null;
    }
    if (allowAlternative && hasPermission(actor, alternative)) {
      actions.push(alternative);
      return null;
    }
    return {
      ok: false as const,
      error: `当前账号无权修改${label}`,
      permission: primary,
    };
  };
  const nextMajors = Array.isArray(body.majors) ? body.majors : current.majors;
  const nextGrades = Array.isArray(body.grades) ? body.grades : current.grades;
  const nextClasses = Array.isArray(body.classes)
    ? body.classes
    : current.classes;

  const majorDiff = recordDiff(current.majors, nextMajors);
  const itemDiff = recordDiff(current.items, body.items);
  const majorChanged =
    majorDiff.added.length > 0 ||
    majorDiff.removed.length > 0 ||
    majorDiff.updated.length > 0 ||
    itemDiff.added.length > 0 ||
    itemDiff.removed.length > 0 ||
    itemDiff.updated.length > 0 ||
    current.title !== String(body.title ?? "") ||
    current.activeMajorId !== String(body.activeMajorId ?? "");
  if (majorChanged) {
    const currentMajorsById = new Map(
      (current.majors as any[]).map((major) => [String(major?.id ?? ""), major]),
    );
    const nextMajorId = String(body.activeMajorId ?? current.activeMajorId ?? "");
    const nextActiveMajor = (nextMajors as any[]).find(
      (major) => String(major?.id ?? "") === nextMajorId,
    );
    const payloadMatchesNextActiveMajor =
      sameJson(body.items ?? [], nextActiveMajor?.items ?? []) &&
      String(body.title ?? "") === String(nextActiveMajor?.name ?? "");
    const onlyOwnedQuickTemporaryChanges =
      majorDiff.added.every(isOwnedQuickTemporaryMajor) &&
      majorDiff.removed.every(isOwnedQuickTemporaryMajor) &&
      majorDiff.updated.every((major: any) =>
        isOwnedQuickTemporaryMajor(currentMajorsById.get(String(major?.id ?? ""))) &&
        isOwnedQuickTemporaryMajor(major),
      );
    const canManageOwnQuickTemporaryChanges =
      (majorDiff.added.length > 0 || majorDiff.removed.length > 0 || majorDiff.updated.length > 0) &&
      onlyOwnedQuickTemporaryChanges &&
      payloadMatchesNextActiveMajor;

    if (majorDiff.added.length) {
      const denied = needEither(
        "major.create",
        "major.quick_create",
        "新建大型考试",
        canManageOwnQuickTemporaryChanges && majorDiff.added.every(
          (major: any) => Array.isArray(major?.targetClassIds) && major.targetClassIds.length > 0,
        ),
      );
      if (denied) return denied;
    }
    if (majorDiff.removed.length || itemDiff.removed.length) {
      const denied = needEither(
        "major.delete",
        "major.quick_create",
        "删除考试",
        canManageOwnQuickTemporaryChanges,
      );
      if (denied) return denied;
    }
    if (
      majorDiff.updated.length ||
      itemDiff.added.length ||
      itemDiff.updated.length ||
      current.title !== String(body.title ?? "") ||
      current.activeMajorId !== String(body.activeMajorId ?? "")
    ) {
      const denied = needEither(
        "major.edit",
        "major.quick_create",
        "大型考试",
        canManageOwnQuickTemporaryChanges,
      );
      if (denied) return denied;
    }
    const classes = new Map(
      (nextClasses as any[]).map((item) => [String(item?.id ?? ""), item]),
    );
    for (const major of changedRecords(current.majors, nextMajors)) {
      const gradeIds = Array.isArray(major?.targetGradeIds)
        ? major.targetGradeIds.map(String)
        : [];
      const classIds = Array.isArray(major?.targetClassIds)
        ? major.targetClassIds.map(String)
        : [];
      if (!gradeIds.length && !classIds.length && !allScope(actor))
        return { ok: false, error: "仅全校范围管理员可以修改全校大型考试" };
      if (gradeIds.some((id: string) => !canAccessGrade(actor, id)))
        return { ok: false, error: "大型考试包含当前账号无权管理的年级" };
      if (
        classIds.some((id: string) => {
          const item: any = classes.get(id);
          return (
            !item || !canAccessClass(actor, String(item.gradeId ?? ""), id)
          );
        })
      )
        return { ok: false, error: "大型考试包含当前账号无权管理的班级" };
    }
  }

  if (
    body.weeklyPlans !== undefined &&
    !sameJson(current.weeklyPlans, body.weeklyPlans)
  ) {
    const diff = recordDiff(current.weeklyPlans ?? [], body.weeklyPlans ?? []);
    if (diff.added.length) {
      const denied = need("weekly.create", "新建周测计划");
      if (denied) return denied;
    }
    if (diff.added.length > 1) {
      const denied = need("weekly.copy", "批量应用周测计划");
      if (denied) return denied;
    }
    if (diff.removed.length) {
      const denied = need("weekly.delete", "删除周测计划");
      if (denied) return denied;
    }
    if (diff.updated.length) {
      const denied = need("weekly.edit", "周测计划");
      if (denied) return denied;
    }
    for (const plan of changedRecords(
      current.weeklyPlans ?? [],
      body.weeklyPlans ?? [],
    )) {
      if (
        !canAccessClass(
          actor,
          String(plan?.gradeId ?? ""),
          String(plan?.classId ?? ""),
        )
      )
        return { ok: false, error: "周测计划超出当前账号的班级管理范围" };
    }
  }
  if (
    (body.activeWeeklyPlanId !== undefined &&
      !sameJson(current.activeWeeklyPlanId, body.activeWeeklyPlanId)) ||
    (body.activeWeeklyPlanIdByClassId !== undefined &&
      !sameJson(
        current.activeWeeklyPlanIdByClassId,
        body.activeWeeklyPlanIdByClassId,
      ))
  ) {
    const denied = need("weekly.edit", "周测生效计划");
    if (denied) return denied;
    const before = current.activeWeeklyPlanIdByClassId ?? {};
    const after = body.activeWeeklyPlanIdByClassId ?? before;
    const classMap = new Map(
      (nextClasses as any[]).map((item) => [String(item?.id ?? ""), item]),
    );
    const cleanedAfter = cleanActiveWeeklyPlanByClass(after, classMap);
    body.activeWeeklyPlanIdByClassId = cleanedAfter;
    const changedClassIds = new Set(
      [...Object.keys(before), ...Object.keys(cleanedAfter)].filter(
        (id) => before[id] !== cleanedAfter[id],
      ),
    );
    for (const classId of changedClassIds) {
      const schoolClass: any = classMap.get(classId);
      if (!schoolClass) continue;
      if (
        !schoolClass ||
        !canAccessClass(actor, String(schoolClass.gradeId ?? ""), classId)
      )
        return { ok: false, error: "生效周测计划超出当前账号的班级管理范围" };
    }
  }
  if (body.grades !== undefined && !sameJson(current.grades, body.grades)) {
    const denied = need("school.grade_manage", "年级结构");
    if (denied) return denied;
    if (!allScope(actor))
      return { ok: false, error: "只有全校范围管理员可以增删年级" };
  }
  if (body.classes !== undefined && !sameJson(current.classes, body.classes)) {
    const denied = need("school.class_manage", "班级结构");
    if (denied) return denied;
    for (const schoolClass of changedRecords(
      current.classes ?? [],
      body.classes ?? [],
    )) {
      if (!canAccessGrade(actor, String(schoolClass?.gradeId ?? "")))
        return { ok: false, error: "班级变更超出当前账号的年级管理范围" };
    }
  }
  if (
    body.scheduleMode !== undefined &&
    current.scheduleMode !== body.scheduleMode
  ) {
    const denied = need("schedule.mode_edit", "全校运行模式");
    if (denied) return denied;
    if (!allScope(actor))
      return { ok: false, error: "只有全校范围管理员可以修改运行模式" };
  }
  if (
    body.weeklyConflictPolicy !== undefined &&
    !sameJson(current.weeklyConflictPolicy, body.weeklyConflictPolicy)
  ) {
    const denied = need("schedule.conflict_edit", "大型考试冲突策略");
    if (denied) return denied;
    if (!allScope(actor))
      return { ok: false, error: "只有全校范围管理员可以修改冲突策略" };
  }
  if (body.alerts !== undefined && !sameJson(current.alerts, body.alerts)) {
    const denied = need("alerts.edit", "全屏提醒");
    if (denied) return denied;
  }
  if (
    body.initialization !== undefined &&
    !sameJson(current.initialization, body.initialization)
  ) {
    const beforeInit = { ...(current.initialization ?? {}) };
    const afterInit = { ...(body.initialization ?? {}) };
    const beforeTrackMode = beforeInit.subjectTrackModeEnabled !== false;
    const afterTrackMode = afterInit.subjectTrackModeEnabled !== false;
    delete beforeInit.subjectTrackModeEnabled;
    delete afterInit.subjectTrackModeEnabled;
    if (sameJson(beforeInit, afterInit) && beforeTrackMode !== afterTrackMode) {
      const denied = need("settings.edit", "分科模式");
      if (denied) return denied;
      return { ok: true, actions: [...new Set(actions)] };
    }
    const denied = need("initialization.run", "初始化设置");
    if (denied) return denied;
    if (!allScope(actor))
      return { ok: false, error: "只有超级管理员可以执行初始化" };
  }
  return { ok: true, actions: [...new Set(actions)] };
}
