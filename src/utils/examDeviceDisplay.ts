import { DEVICE_ONLINE_WINDOW_MS, type DeviceBindingInfo } from '../shared/deviceContracts';
import type { SchoolClass } from '../types/school';

/**
 * 考试详情里「设备状态」的取数口径。
 *
 * 这里只做展示所需的筛选、排序与汇总，不做任何控制类操作。
 * 抽成纯函数的原因：设备一多，**先排序再截断**这件事必须有回归测试兜底，
 * 否则被截掉的会是正在掉线/显示异常的教室。
 */

export type ExamDeviceFilter = 'all' | 'online' | 'offline';

export type ExamDeviceSummary = {
  /** 已按「显示异常 → 在线 → 离线」排好序，同组内按最近在线时间倒序。 */
  devices: DeviceBindingInfo[];
  online: number;
  offline: number;
  unboundClasses: number;
  /** 未绑定设备的班级名，供展开查看。 */
  unboundClassNames: string[];
  /** 在线且正在显示别的考试的台数。 */
  showingOther: number;
};

export function isDeviceOnline(device: Pick<DeviceBindingInfo, 'lastSeenAt'>, now: number): boolean {
  return now - device.lastSeenAt <= DEVICE_ONLINE_WINDOW_MS;
}

/** 教室屏显示的不是本场考试：上一场没清干净，或有人手动切过。 */
export function deviceShowsOtherExam(device: Pick<DeviceBindingInfo, 'currentExam'>, examName: string): boolean {
  return Boolean(device.currentExam) && device.currentExam !== examName;
}

export function buildExamDeviceSummary(input: {
  devices: readonly DeviceBindingInfo[];
  classes: readonly SchoolClass[];
  targetGradeIds: readonly string[];
  targetClassIds: readonly string[];
  examName: string;
  now: number;
}): ExamDeviceSummary {
  const { devices, classes, targetGradeIds, targetClassIds, examName, now } = input;
  const schoolWide = targetGradeIds.length === 0 && targetClassIds.length === 0;
  const inScope = devices.filter(
    (item) =>
      !item.revoked && (schoolWide || targetGradeIds.includes(item.gradeId) || targetClassIds.includes(item.classId)),
  );
  // 接口是按 device_instances.updated_at 给的，后台动作也会改写它，不能直接当优先级用。
  const rank = (item: DeviceBindingInfo) => {
    const online = isDeviceOnline(item, now);
    if (online && deviceShowsOtherExam(item, examName)) return 0;
    return online ? 1 : 2;
  };
  const sorted = [...inScope].sort((left, right) => rank(left) - rank(right) || right.lastSeenAt - left.lastSeenAt);
  const online = sorted.filter((item) => isDeviceOnline(item, now)).length;
  const coveredClassIds = new Set(inScope.map((item) => item.classId).filter(Boolean));
  const scopedClasses = classes.filter(
    (item) => schoolWide || targetClassIds.includes(item.id) || targetGradeIds.includes(item.gradeId),
  );
  const unbound = scopedClasses.filter((item) => !coveredClassIds.has(item.id));
  return {
    devices: sorted,
    online,
    offline: sorted.length - online,
    unboundClasses: unbound.length,
    unboundClassNames: unbound.map((item) => item.name),
    showingOther: sorted.filter((item) => deviceShowsOtherExam(item, examName)).length,
  };
}

export function filterExamDevices(
  devices: readonly DeviceBindingInfo[],
  filter: ExamDeviceFilter,
  now: number,
): DeviceBindingInfo[] {
  if (filter === 'all') return [...devices];
  return devices.filter((item) => (filter === 'online') === isDeviceOnline(item, now));
}
