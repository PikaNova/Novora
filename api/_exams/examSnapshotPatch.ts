import type { ExamOperationPatch } from '../../src/shared/examLifecycleOperations.js';

/**
 * 生命周期补丁 → 权威快照（`exam_data.majors[i]`）里的同名字段。
 *
 * 快照仍是唯一权威来源，`exam_records` 只是派生投影；所以任何一次生命周期写入
 * （人工动作、系统自动开考/自动结束）都必须同时落到快照上，否则教室端、ClassIsland 插件
 * 与设备心跳读快照时看到的还是旧状态。
 *
 * 只写补丁里出现过的字段（用 hasOwnProperty 判断可空字段），避免把未涉及的字段抹掉。
 */
export function applyOperationPatchToMajor(major: Record<string, unknown>, patch: ExamOperationPatch): void {
  if (patch.actualStartAt !== undefined) major.actualStartAt = patch.actualStartAt;
  if (patch.actualEndAt !== undefined) major.actualEndAt = patch.actualEndAt;
  if (patch.endAt !== undefined) major.endAt = patch.endAt;
  if (Object.prototype.hasOwnProperty.call(patch, 'pausedAt')) {
    if (patch.pausedAt == null) delete major.pausedAt;
    else major.pausedAt = patch.pausedAt;
  }
  if (patch.pausedMs !== undefined) major.pausedMs = patch.pausedMs;
  if (Object.prototype.hasOwnProperty.call(patch, 'stopRequestedAt')) {
    if (patch.stopRequestedAt == null) delete major.stopRequestedAt;
    else major.stopRequestedAt = patch.stopRequestedAt;
  }
  // 结束同时把 endedAt 写进快照：投影派生态、心跳版本与插件 payload 都看这个字段。
  if (patch.status === 'ended' && patch.actualEndAt !== undefined) major.endedAt = patch.actualEndAt;
}
