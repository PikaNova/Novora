// api/_exams/permissions.ts
// 鉴权校验：validateMutation 与 allScope。从原 api/exams.ts 抽出，保持单一职责。
// 权限判断逻辑统一来自 src/shared/permissionRules.ts，与 api/_auth.ts、src/services/examService.ts 保持一致。

import { canAccessClass, canAccessGrade, hasPermission, type AdminActor, type Permission } from '../_auth.js';
import { hasAllScope as sharedHasAllScope } from '../../src/shared/permissionRules.js';
import { isQuickTemporaryMajorFullyInScope } from '../../src/utils/majorOwnership.js';
import { changedRecords, cleanActiveWeeklyPlanByClass, recordDiff, sameJson } from './diff.js';
import type { ExamPayload } from './payload.js';
import { asRecord } from '../../src/shared/typeGuards.js';

export const allScope = (actor: AdminActor) => sharedHasAllScope(actor);

/**
 * 已归档的考试是只读历史（T-284-01）：快照里对应条目一律回退到服务端当前值，
 * 也不允许从快照中移除——记录层靠快照里的条目做运行时投影，移除会让记录失去载体、
 * 审计链出现孤儿。要修改必须先 unarchive。
 *
 * 返回被冻结的考试 id，路由会随保存响应回传，便于排查「改了却没生效」。
 */
export function freezeArchivedMajors(
  current: ExamPayload,
  body: Record<string, unknown>,
): { body: Record<string, unknown>; frozenIds: string[]; frozenMajors: unknown[] } {
  if (!Array.isArray(body.majors)) return { body, frozenIds: [], frozenMajors: [] };
  const archivedById = new Map<string, unknown>();
  for (const major of current.majors) {
    const record = asRecord(major);
    if (record.archivedAt == null) continue;
    archivedById.set(String(record.id ?? ''), major);
  }
  if (!archivedById.size) return { body, frozenIds: [], frozenMajors: [] };

  const frozenIds: string[] = [];
  // 连同服务端版本一起回传：客户端据此把本地副本纠正回服务端版本，否则会出现
  // 「本机显示删除/改名成功，刷新后又变回来」的幽灵改动。
  const frozenMajors: unknown[] = [];
  const submittedIds = new Set<string>();
  const majors: unknown[] = [];
  for (const raw of body.majors) {
    const id = String(asRecord(raw).id ?? '');
    submittedIds.add(id);
    const frozen = archivedById.get(id);
    if (!frozen) {
      majors.push(raw);
      continue;
    }
    if (!sameJson(raw, frozen)) {
      frozenIds.push(id);
      frozenMajors.push(frozen);
    }
    majors.push(frozen);
  }
  // 被删掉的归档考试按原相对顺序补回，避免历史记录凭空消失。
  for (const [id, major] of archivedById) {
    if (submittedIds.has(id)) continue;
    frozenIds.push(id);
    frozenMajors.push(major);
    majors.push(major);
  }
  return { body: { ...body, majors }, frozenIds, frozenMajors };
}

const isOwnedQuickTemporaryMajor = (actor: AdminActor, major: unknown) => {
  const source = asRecord(major);
  return source.source === 'quick' && source.temporary === true && source.createdBy === actor.id;
};

function canControlQuickTemporaryMajorInScope(actor: AdminActor, major: unknown, classes: readonly unknown[]): boolean {
  const majorRecord = asRecord(major);
  const classesById = new Map(
    classes.map((item) => {
      const record = asRecord(item);
      return [String(record.id ?? ''), record] as const;
    }),
  );
  return isQuickTemporaryMajorFullyInScope(
    majorRecord as unknown as Parameters<typeof isQuickTemporaryMajorFullyInScope>[0],
    (classId) => {
      const schoolClass = classesById.get(classId);
      return !!schoolClass && canAccessClass(actor, String(schoolClass.gradeId ?? ''), classId);
    },
    (gradeId) => canAccessGrade(actor, gradeId),
  );
}

function isEarlyQuickMajorEnd(current: unknown, next: unknown): boolean {
  const currentSource = asRecord(current);
  const nextSource = asRecord(next);
  const currentEndedAt = Number(currentSource.endedAt ?? 0);
  const nextEndedAt = Number(nextSource.endedAt);
  if (
    !current ||
    !next ||
    (Number.isFinite(currentEndedAt) && currentEndedAt > 0) ||
    !Number.isFinite(nextEndedAt) ||
    nextEndedAt <= 0
  )
    return false;
  const { endedAt: _currentEndedAt, items: currentItems, ...currentRest } = currentSource;
  const { endedAt: _nextEndedAt, items: nextItems, ...nextRest } = nextSource;
  if (!sameJson(currentRest, nextRest) || !Array.isArray(currentItems) || !Array.isArray(nextItems)) return false;
  if (currentItems.length !== nextItems.length) return false;
  return currentItems.every((rawItem: unknown, index: number) => {
    const item = asRecord(rawItem);
    const nextItem = asRecord(nextItems[index]);
    if (!nextItem || nextItem.enabled !== false) return false;
    const { enabled: _currentEnabled, ...currentItemRest } = item;
    const { enabled: _nextEnabled, ...nextItemRest } = nextItem;
    return sameJson(currentItemRest, nextItemRest);
  });
}

export function isolateQuickMajorCreate(
  actor: AdminActor,
  current: ExamPayload,
  body: Record<string, unknown>,
): Record<string, unknown> {
  if (
    hasPermission(actor, 'major.create') ||
    !hasPermission(actor, 'major.quick_create') ||
    !Array.isArray(body.majors)
  )
    return body;

  const activeMajorId = String(body.activeMajorId ?? '');
  const activeMajor = body.majors.find((major: Record<string, unknown>) => String(major?.id ?? '') === activeMajorId);
  const alreadyExists = current.majors.some((major) => String(major?.id ?? '') === activeMajorId);
  const ownsNewClassQuickMajor =
    activeMajor &&
    !alreadyExists &&
    isOwnedQuickTemporaryMajor(actor, activeMajor) &&
    Array.isArray(activeMajor.targetClassIds) &&
    activeMajor.targetClassIds.length > 0;

  if (ownsNewClassQuickMajor) {
    return {
      ...body,
      majors: [...current.majors, activeMajor],
      items: Array.isArray(activeMajor.items) ? activeMajor.items : [],
      title: typeof activeMajor.name === 'string' ? activeMajor.name : '',
      activeMajorId,
    };
  }

  const bodyMajorIds = new Set((body.majors as Array<Record<string, unknown>>).map((major) => String(major?.id ?? '')));
  const removedIds = new Set(
    current.majors
      .filter((major) => isOwnedQuickTemporaryMajor(actor, major) && !bodyMajorIds.has(String(major?.id ?? '')))
      .map((major) => String(major?.id ?? '')),
  );
  if (!removedIds.size) return body;

  return {
    ...body,
    majors: current.majors.filter((major) => !removedIds.has(String(major?.id ?? ''))),
  };
}

export function sanitizeStaleSnapshot(
  actor: AdminActor,
  current: ExamPayload,
  body: Record<string, unknown>,
): Record<string, unknown> {
  // 全校范围账号直接信任完整快照（超管可改一切，无需清洗）。
  if (allScope(actor)) return body;
  let next = body;

  // ── 周测计划：仅保留账号可管理班级范围内的提交，其余回退服务器当前值 ──
  if (Array.isArray(next.weeklyPlans)) {
    const submittedById = new Map(
      next.weeklyPlans.map((rawPlan: unknown) => {
        const plan = asRecord(rawPlan);
        return [String(plan.id ?? ''), plan] as const;
      }),
    );
    const seen = new Set<string>();
    const merged: Array<unknown> = [];
    for (const plan of current.weeklyPlans) {
      const record = asRecord(plan);
      const id = String(record.id ?? '');
      seen.add(id);
      if (canAccessClass(actor, String(record.gradeId ?? ''), String(record.classId ?? ''))) {
        const submitted = submittedById.get(id);
        if (submitted) merged.push(submitted);
      } else {
        merged.push(plan);
      }
    }
    for (const plan of next.weeklyPlans) {
      const record = asRecord(plan);
      if (seen.has(String(record.id ?? ''))) continue;
      if (canAccessClass(actor, String(record.gradeId ?? ''), String(record.classId ?? ''))) {
        merged.push(plan);
      }
    }
    next = { ...next, weeklyPlans: merged };
  }

  // ── 年级结构：非全校账号一律以服务器当前值为准 ──
  if (Array.isArray(next.grades) && !sameJson(current.grades, next.grades)) {
    next = { ...next, grades: current.grades };
  }

  // ── 班级结构：无 class_manage 全量回退；有 class_manage 按年级范围合并 ──
  if (Array.isArray(next.classes)) {
    if (!hasPermission(actor, 'school.class_manage')) {
      if (!sameJson(current.classes, next.classes)) {
        next = { ...next, classes: current.classes };
      }
    } else {
      const submittedById = new Map(
        next.classes.map((rawSchoolClass: unknown) => {
          const schoolClass = asRecord(rawSchoolClass);
          return [String(schoolClass.id ?? ''), schoolClass] as const;
        }),
      );
      const seen = new Set<string>();
      const merged: Array<unknown> = [];
      for (const schoolClass of current.classes) {
        const record = asRecord(schoolClass);
        const id = String(record.id ?? '');
        seen.add(id);
        if (canAccessGrade(actor, String(record.gradeId ?? ''))) {
          const submitted = submittedById.get(id);
          if (submitted) merged.push(submitted);
        } else {
          merged.push(schoolClass);
        }
      }
      for (const schoolClass of next.classes) {
        const record = asRecord(schoolClass);
        if (seen.has(String(record.id ?? ''))) continue;
        if (canAccessGrade(actor, String(record.gradeId ?? ''))) {
          merged.push(schoolClass);
        }
      }
      next = { ...next, classes: merged };
    }
  }

  // ── 生效周测计划映射：范围外班级回退 ──
  if (
    next.activeWeeklyPlanIdByClassId !== null &&
    typeof next.activeWeeklyPlanIdByClassId === 'object' &&
    !Array.isArray(next.activeWeeklyPlanIdByClassId)
  ) {
    const classesForMapping: readonly unknown[] = Array.isArray(next.classes) ? next.classes : current.classes;
    const classesById = new Map(
      classesForMapping.map((rawSchoolClass) => {
        const schoolClass = asRecord(rawSchoolClass);
        return [String(schoolClass.id ?? ''), schoolClass] as const;
      }),
    );
    const currentMapping = (current.activeWeeklyPlanIdByClassId as Record<string, string | null>) ?? {};
    const submittedMapping = next.activeWeeklyPlanIdByClassId as Record<string, string | null>;
    const mergedMapping: Record<string, string | null> = { ...submittedMapping };

    for (const classId of new Set([...Object.keys(currentMapping), ...Object.keys(submittedMapping)])) {
      const schoolClass = classesById.get(classId);
      if (schoolClass && canAccessClass(actor, String(schoolClass.gradeId ?? ''), classId)) continue;
      if (classId in currentMapping) mergedMapping[classId] = currentMapping[classId];
      else delete mergedMapping[classId];
    }

    next = { ...next, activeWeeklyPlanIdByClassId: mergedMapping };
  }

  // ── 大型考试：权威合并。
  //    有 major.edit 且目标年级/班级全部在账号范围内的提交保留；
  //    账号自建的临时考试、范围内的提前结束保留；
  //    其余（越权/陈旧/全校）一律回退服务器当前值。 ──
  if (Array.isArray(next.majors)) {
    const submittedById = new Map(
      next.majors.map((rawMajor: unknown) => {
        const major = asRecord(rawMajor);
        return [String(major.id ?? ''), major] as const;
      }),
    );
    const currentMajors = current.majors;
    const classesForMajors: readonly unknown[] = Array.isArray(next.classes) ? next.classes : current.classes;
    const classesById = new Map(
      classesForMajors.map((rawSchoolClass) => {
        const schoolClass = asRecord(rawSchoolClass);
        return [String(schoolClass.id ?? ''), schoolClass] as const;
      }),
    );
    const majorTargetsInScope = (rawMajor: unknown): boolean => {
      const major = asRecord(rawMajor);
      const gradeIds = Array.isArray(major.targetGradeIds) ? major.targetGradeIds.map(String) : [];
      const classIds = Array.isArray(major.targetClassIds) ? major.targetClassIds.map(String) : [];
      if (!gradeIds.length && !classIds.length) return false; // 全校范围：作用域账号不可管理
      if (!gradeIds.every((id: string) => canAccessGrade(actor, id))) return false;
      return classIds.every((id: string) => {
        const schoolClass = classesById.get(id);
        return !!schoolClass && canAccessClass(actor, String(schoolClass.gradeId ?? ''), id);
      });
    };
    const seen = new Set<string>();
    const merged: Array<unknown> = [];
    const canManageOwnMajor = (major: unknown) =>
      hasPermission(actor, 'major.quick_create') && isOwnedQuickTemporaryMajor(actor, major);
    const canEndScopedMajor = (currentMajor: unknown, submittedMajor: unknown) =>
      hasPermission(actor, 'major.quick_create') &&
      !!currentMajor &&
      !!submittedMajor &&
      canControlQuickTemporaryMajorInScope(actor, currentMajor, classesForMajors) &&
      canControlQuickTemporaryMajorInScope(actor, submittedMajor, classesForMajors) &&
      isEarlyQuickMajorEnd(currentMajor, submittedMajor);
    const canEditMajorInScope = (major: unknown): boolean =>
      hasPermission(actor, 'major.edit') && majorTargetsInScope(major);

    for (const currentMajor of currentMajors) {
      const id = String(asRecord(currentMajor).id ?? '');
      seen.add(id);
      const submittedMajor = submittedById.get(id);
      if (canManageOwnMajor(currentMajor)) {
        if (submittedMajor) merged.push(submittedMajor);
      } else if (canEndScopedMajor(currentMajor, submittedMajor)) {
        merged.push(submittedMajor);
      } else if (submittedMajor && canEditMajorInScope(submittedMajor)) {
        merged.push(submittedMajor);
      } else {
        merged.push(currentMajor);
      }
    }
    for (const submittedMajor of next.majors) {
      if (seen.has(String(asRecord(submittedMajor).id ?? ''))) continue;
      if (canManageOwnMajor(submittedMajor) || canEditMajorInScope(submittedMajor)) {
        merged.push(submittedMajor);
      }
    }
    next = { ...next, majors: merged };

    // title / activeMajorId / items 不信任 body：从“清洗后接受的 activeMajor”派生，
    // 避免陈旧标题/活动考试被写入，也避免班级管理员因陈旧值触发 major.edit 校验。
    const mergedIds = new Set(merged.map((major) => String(asRecord(major).id ?? '')));
    const bodyActiveId = String(body.activeMajorId ?? '');
    const bodyActiveAccepted = bodyActiveId !== '' && mergedIds.has(bodyActiveId);
    const activeId = bodyActiveAccepted ? bodyActiveId : String(current.activeMajorId ?? '');
    const activeMajor = merged.map(asRecord).find((major) => String(major.id ?? '') === activeId) ?? null;
    next = {
      ...next,
      activeMajorId: activeId,
      title: activeMajor ? String(activeMajor.name ?? '') : String(current.title ?? ''),
      items: activeMajor && Array.isArray(activeMajor.items) ? activeMajor.items : (current.items ?? []),
    };
  }

  // ── 全局字段：非全校账号一律回退服务器当前值（校验要求全校/超管权限） ──
  if (body.scheduleMode !== undefined && current.scheduleMode !== body.scheduleMode) {
    next = { ...next, scheduleMode: current.scheduleMode };
  }
  if (body.weeklyConflictPolicy !== undefined && !sameJson(current.weeklyConflictPolicy, body.weeklyConflictPolicy)) {
    next = { ...next, weeklyConflictPolicy: current.weeklyConflictPolicy };
  }
  if (body.initialization !== undefined && !sameJson(current.initialization, body.initialization)) {
    next = { ...next, initialization: current.initialization };
  }

  // ── 全屏提醒：无 alerts.edit 时回退 ──
  if (next.alerts !== undefined && !hasPermission(actor, 'alerts.edit') && !sameJson(current.alerts, next.alerts)) {
    next = { ...next, alerts: current.alerts };
  }

  return next;
}
export function validateMutation(
  actor: AdminActor,
  current: ExamPayload,
  body: Record<string, unknown>,
): { ok: true; actions: string[] } | { ok: false; error: string; permission?: Permission } {
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
  const needEither = (primary: Permission, alternative: Permission, label: string, allowAlternative: boolean) => {
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
  const nextMajors = (Array.isArray(body.majors) ? body.majors : current.majors) as Array<{ id?: unknown }>;
  const nextClasses: readonly unknown[] = Array.isArray(body.classes) ? body.classes : current.classes;
  // 省略安全：客户端现在只提交改动的域，未携带的域一律按服务器当前值参与比对。
  // 否则「只发周测」会被 recordDiff 当成「把大型考试全删了」，触发无谓的权限拒绝。
  const nextItems = (Array.isArray(body.items) ? body.items : current.items) as Array<{ id?: unknown }>;
  const nextTitle = typeof body.title === 'string' ? body.title : current.title;
  const nextActiveMajorId = typeof body.activeMajorId === 'string' ? body.activeMajorId : current.activeMajorId;

  const majorDiff = recordDiff(current.majors, nextMajors);
  const itemDiff = recordDiff(current.items, nextItems);
  const majorChanged =
    majorDiff.added.length > 0 ||
    majorDiff.removed.length > 0 ||
    majorDiff.updated.length > 0 ||
    itemDiff.added.length > 0 ||
    itemDiff.removed.length > 0 ||
    itemDiff.updated.length > 0 ||
    current.title !== nextTitle ||
    current.activeMajorId !== nextActiveMajorId;
  if (majorChanged) {
    const currentMajorsById = new Map(current.majors.map((major) => [String(major?.id ?? ''), major]));
    const nextMajorId = String(nextActiveMajorId ?? '');
    const nextActiveMajor = nextMajors.map(asRecord).find((major) => String(major.id ?? '') === nextMajorId);
    const payloadMatchesNextActiveMajor =
      sameJson(nextItems, nextActiveMajor?.items ?? []) && nextTitle === String(nextActiveMajor?.name ?? '');
    const onlyOwnedQuickTemporaryChanges =
      majorDiff.added.every((major: unknown) => isOwnedQuickTemporaryMajor(actor, major)) &&
      majorDiff.removed.every((major: unknown) => isOwnedQuickTemporaryMajor(actor, major)) &&
      majorDiff.updated.every(
        (major: unknown) =>
          isOwnedQuickTemporaryMajor(actor, currentMajorsById.get(String(asRecord(major).id ?? ''))) &&
          isOwnedQuickTemporaryMajor(actor, major),
      );
    const canManageOwnQuickTemporaryChanges =
      (majorDiff.added.length > 0 || majorDiff.removed.length > 0 || majorDiff.updated.length > 0) &&
      onlyOwnedQuickTemporaryChanges &&
      payloadMatchesNextActiveMajor;
    const canEndScopedQuickTemporaryMajor =
      majorDiff.added.length === 0 &&
      majorDiff.removed.length === 0 &&
      majorDiff.updated.length > 0 &&
      payloadMatchesNextActiveMajor &&
      majorDiff.updated.every((major: unknown) => {
        const currentMajor = currentMajorsById.get(String(asRecord(major).id ?? ''));
        return (
          canControlQuickTemporaryMajorInScope(actor, currentMajor, current.classes) &&
          canControlQuickTemporaryMajorInScope(actor, major, nextClasses) &&
          isEarlyQuickMajorEnd(currentMajor, major)
        );
      });

    if (majorDiff.added.length) {
      const denied = needEither(
        'major.create',
        'major.quick_create',
        '新建大型考试',
        canManageOwnQuickTemporaryChanges &&
          majorDiff.added.every((major: unknown) => {
            const record = asRecord(major);
            return Array.isArray(record.targetClassIds) && record.targetClassIds.length > 0;
          }),
      );
      if (denied) return denied;
    }
    if (majorDiff.removed.length || itemDiff.removed.length) {
      const denied = needEither('major.delete', 'major.quick_create', '删除考试', canManageOwnQuickTemporaryChanges);
      if (denied) return denied;
    }
    if (
      majorDiff.updated.length ||
      itemDiff.added.length ||
      itemDiff.updated.length ||
      current.title !== nextTitle ||
      current.activeMajorId !== nextActiveMajorId
    ) {
      const denied = needEither(
        'major.edit',
        'major.quick_create',
        '大型考试',
        canManageOwnQuickTemporaryChanges || canEndScopedQuickTemporaryMajor,
      );
      if (denied) return denied;
    }
    const classes = new Map(
      nextClasses.map((rawItem) => {
        const item = asRecord(rawItem);
        return [String(item.id ?? ''), item] as const;
      }),
    );
    for (const rawMajor of changedRecords(current.majors, nextMajors)) {
      const major = asRecord(rawMajor);
      const gradeIds = Array.isArray(major.targetGradeIds) ? major.targetGradeIds.map(String) : [];
      const classIds = Array.isArray(major.targetClassIds) ? major.targetClassIds.map(String) : [];
      if (!gradeIds.length && !classIds.length && !allScope(actor))
        return { ok: false, error: '仅全校范围管理员可以修改全校大型考试' };
      if (gradeIds.some((id: string) => !canAccessGrade(actor, id)))
        return { ok: false, error: '大型考试包含当前账号无权管理的年级' };
      if (
        classIds.some((id: string) => {
          const item = asRecord(classes.get(id));
          return !item || !canAccessClass(actor, String(item.gradeId ?? ''), id);
        })
      )
        return { ok: false, error: '大型考试包含当前账号无权管理的班级' };
    }
  }

  if (body.weeklyPlans !== undefined && !sameJson(current.weeklyPlans, body.weeklyPlans)) {
    const diff = recordDiff(current.weeklyPlans, (body.weeklyPlans as Array<{ id?: unknown }> | undefined) ?? []);
    if (diff.added.length) {
      const denied = need('weekly.create', '新建周测计划');
      if (denied) return denied;
    }
    if (diff.added.length > 1) {
      const denied = need('weekly.copy', '批量应用周测计划');
      if (denied) return denied;
    }
    if (diff.removed.length) {
      const denied = need('weekly.delete', '删除周测计划');
      if (denied) return denied;
    }
    if (diff.updated.length) {
      const denied = need('weekly.edit', '周测计划');
      if (denied) return denied;
    }
    for (const rawPlan of changedRecords(
      current.weeklyPlans,
      (body.weeklyPlans as Array<{ id?: unknown }> | undefined) ?? [],
    )) {
      const plan = asRecord(rawPlan);
      if (!canAccessClass(actor, String(plan.gradeId ?? ''), String(plan.classId ?? '')))
        return { ok: false, error: '周测计划超出当前账号的班级管理范围' };
    }
  }
  if (
    (body.activeWeeklyPlanId !== undefined && !sameJson(current.activeWeeklyPlanId, body.activeWeeklyPlanId)) ||
    (body.activeWeeklyPlanIdByClassId !== undefined &&
      !sameJson(current.activeWeeklyPlanIdByClassId, body.activeWeeklyPlanIdByClassId))
  ) {
    const denied = need('weekly.edit', '周测生效计划');
    if (denied) return denied;
    const before = current.activeWeeklyPlanIdByClassId ?? {};
    const after = (body.activeWeeklyPlanIdByClassId as Record<string, string | null> | undefined) ?? before;
    const classMap = new Map(
      nextClasses.map((rawItem) => {
        const item = asRecord(rawItem);
        return [String(item.id ?? ''), item] as const;
      }),
    );
    const cleanedAfter = cleanActiveWeeklyPlanByClass(after, classMap);
    body.activeWeeklyPlanIdByClassId = cleanedAfter;
    const changedClassIds = new Set(
      [...Object.keys(before), ...Object.keys(cleanedAfter)].filter((id) => before[id] !== cleanedAfter[id]),
    );
    for (const classId of changedClassIds) {
      const schoolClass = asRecord(classMap.get(classId));
      if (!schoolClass) continue;
      if (!schoolClass || !canAccessClass(actor, String(schoolClass.gradeId ?? ''), classId))
        return { ok: false, error: '生效周测计划超出当前账号的班级管理范围' };
    }
  }
  if (body.grades !== undefined && !sameJson(current.grades, body.grades)) {
    const denied = need('school.grade_manage', '年级结构');
    if (denied) return denied;
    if (!allScope(actor)) return { ok: false, error: '只有全校范围管理员可以增删年级' };
  }
  if (body.classes !== undefined && !sameJson(current.classes, body.classes)) {
    const denied = need('school.class_manage', '班级结构');
    if (denied) return denied;
    for (const rawSchoolClass of changedRecords(
      current.classes,
      (body.classes as Array<{ id?: unknown }> | undefined) ?? [],
    )) {
      const schoolClass = asRecord(rawSchoolClass);
      if (!canAccessGrade(actor, String(schoolClass.gradeId ?? '')))
        return { ok: false, error: '班级变更超出当前账号的年级管理范围' };
    }
  }
  if (body.scheduleMode !== undefined && current.scheduleMode !== body.scheduleMode) {
    const denied = need('schedule.mode_edit', '全校运行模式');
    if (denied) return denied;
    if (!allScope(actor)) return { ok: false, error: '只有全校范围管理员可以修改运行模式' };
  }
  if (body.weeklyConflictPolicy !== undefined && !sameJson(current.weeklyConflictPolicy, body.weeklyConflictPolicy)) {
    const denied = need('schedule.conflict_edit', '大型考试冲突策略');
    if (denied) return denied;
    if (!allScope(actor)) return { ok: false, error: '只有全校范围管理员可以修改冲突策略' };
  }
  if (body.alerts !== undefined && !sameJson(current.alerts, body.alerts)) {
    const denied = need('alerts.edit', '全屏提醒');
    if (denied) return denied;
  }
  if (body.initialization !== undefined && !sameJson(current.initialization, body.initialization)) {
    const beforeInit = { ...(current.initialization ?? {}) };
    const afterInit = { ...((body.initialization ?? {}) as Record<string, unknown>) };
    const beforeTrackMode = beforeInit.subjectTrackModeEnabled === true;
    const afterTrackMode = afterInit.subjectTrackModeEnabled === true;
    delete beforeInit.subjectTrackModeEnabled;
    delete afterInit.subjectTrackModeEnabled;
    if (sameJson(beforeInit, afterInit) && beforeTrackMode !== afterTrackMode) {
      const denied = need('settings.edit', '分科模式');
      if (denied) return denied;
      return { ok: true, actions: [...new Set(actions)] };
    }
    const denied = need('initialization.run', '初始化设置');
    if (denied) return denied;
    if (!allScope(actor)) return { ok: false, error: '只有超级管理员可以执行初始化' };
  }
  return { ok: true, actions: [...new Set(actions)] };
}
