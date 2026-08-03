import assert from "node:assert/strict";
import test from "node:test";
import type { PermissionSubject } from "../src/shared/permissionRules.js";
import { getShanghaiDateKey, addDaysToDateKey } from "../src/utils/weeklySchedule.js";
import {
  actorVisibleGradeIds,
  aggregateStats,
  buildGradeDistribution,
  buildOngoing,
  buildRecentEnded,
  buildSubjectDistribution,
  buildUpcoming,
  classifyDevices,
  collectScopedItems,
  dashboardScopeLabel,
  itemAppliesToActor,
  scopedDevices,
  type DashboardClass,
  type DashboardDevice,
  type DashboardGrade,
  type DashboardMajor,
} from "../api/_exams/dashboard.js";

type Scope = { type: "all" | "grade" | "class"; gradeId?: string; classId?: string };

function actorOf(permissions: string[], scopes: Scope[]): PermissionSubject {
  return { permissions, scopes } as PermissionSubject;
}

const allScope = actorOf(["*"], []);
const gradeAdminG1 = actorOf(["overview.read"], [{ type: "grade", gradeId: "g1" }]);
const classAdminC1 = actorOf(["overview.read"], [{ type: "class", gradeId: "g1", classId: "c1" }]);

const grades: DashboardGrade[] = [
  { id: "g1", name: "高一", enabled: true },
  { id: "g2", name: "高二", enabled: true },
];
const classes: DashboardClass[] = [
  { id: "c1", gradeId: "g1", name: "高一1班", enabled: true },
  { id: "c2", gradeId: "g1", name: "高一2班", enabled: true },
  { id: "c3", gradeId: "g2", name: "高二1班", enabled: true },
];

const todayKey = getShanghaiDateKey(Date.now());
const yesterdayKey = addDaysToDateKey(todayKey, -1);
const now = new Date(todayKey + "T12:00").getTime();

function item(id: string, name: string, date: string, start: string, end: string, extra: Record<string, unknown> = {}) {
  return { id, name, startTime: date + "T" + start, endTime: date + "T" + end, enabled: true, ...extra };
}

const majors: DashboardMajor[] = [
  {
    id: "m-all",
    name: "全校考试",
    items: [
      item("i-all", "语文", todayKey, "11:00", "13:00"),
    ],
  },
  {
    id: "m-g1",
    name: "高一大考",
    targetGradeIds: ["g1"],
    items: [
      item("i-g1", "数学", todayKey, "14:00", "15:00"),
      item("i-c1", "英语", todayKey, "09:00", "10:30", { targetClassIds: ["c1"] }),
    ],
  },
  {
    id: "m-g2",
    name: "高二大考",
    targetGradeIds: ["g2"],
    items: [
      item("i-g2", "物理", todayKey, "16:00", "17:00"),
    ],
  },
  {
    id: "m-ended",
    name: "已结束考试",
    items: [
      item("i-ended", "历史", todayKey, "07:00", "08:00"),
    ],
  },
];

const devices: DashboardDevice[] = [
  { instance_id: "d1", grade_id: "g1", class_id: "c1", revoked: false, is_management: false, last_seen_at: now - 10_000, current_exam: "语文" },
  { instance_id: "d2", grade_id: "g1", class_id: "c2", revoked: false, is_management: false, last_seen_at: now - 200_000, current_exam: null },
  { instance_id: "d3", grade_id: "g2", class_id: "c3", revoked: false, is_management: false, last_seen_at: now - 5_000, current_exam: null },
  { instance_id: "d4", grade_id: "g1", class_id: "c1", revoked: true, is_management: false, last_seen_at: now - 1_000, current_exam: "数学" },
  { instance_id: "d5", grade_id: "g1", class_id: "c1", revoked: false, is_management: true, last_seen_at: now - 1_000, current_exam: null },
];

test("school-wide exams count for a grade administrator (decision)", () => {
  assert.equal(itemAppliesToActor(gradeAdminG1, majors[0], majors[0].items[0], grades, classes), true);
  const items = collectScopedItems(majors, grades, classes, gradeAdminG1);
  const ids = items.map(item => item.id).sort();
  assert.deepEqual(ids, ["i-all", "i-c1", "i-ended", "i-g1"]);
});

test("grade scope includes class-targeted items in its grade and excludes other grades", () => {
  const items = collectScopedItems(majors, grades, classes, gradeAdminG1);
  assert.equal(items.some(item => item.id === "i-c1"), true);
  assert.equal(items.some(item => item.id === "i-g2"), false);
});

test("class-scoped actor sees school-wide, own-grade and own-class items", () => {
  const items = collectScopedItems(majors, grades, classes, classAdminC1);
  const ids = items.map(item => item.id).sort();
  assert.deepEqual(ids, ["i-all", "i-c1", "i-ended", "i-g1"]);
});

test("all-scope actor sees every item", () => {
  const items = collectScopedItems(majors, grades, classes, allScope);
  assert.equal(items.length, 5);
});

test("aggregateStats buckets phases, today and this week", () => {
  const items = collectScopedItems(majors, grades, classes, allScope);
  const stats = aggregateStats(items, now);
  assert.equal(stats.total, 5);
  assert.equal(stats.ongoing, 1); // i-all 11:00-13:00 包含 now 12:00
  assert.equal(stats.upcoming, 2); // i-g1 14:00、i-g2 16:00
  assert.equal(stats.ended, 2); // i-c1 已过 10:30、i-ended 昨天
  assert.equal(stats.today, 5); // 全部 5 场均在今天
  assert.equal(stats.thisWeek, 5);
});

test("major endedAt moves items out of ongoing/upcoming and into ended", () => {
  const endedMajor: DashboardMajor = { ...majors[0], endedAt: now - 1_000, items: [{ ...majors[0].items[0], id: "i-ended-now" }] };
  const items = collectScopedItems([endedMajor], grades, classes, allScope);
  assert.equal(buildOngoing(items, now).length, 0);
  assert.equal(buildUpcoming(items, now).length, 0);
  assert.equal(buildRecentEnded(items, now).some(entry => entry.id === "i-ended-now"), true);
});

test("subject distribution groups upcoming exams within the window", () => {
  const items = collectScopedItems(majors, grades, classes, allScope);
  const rows = buildSubjectDistribution(items, now);
  const chinese = rows.find(row => row.label === "语文");
  assert.equal(chinese?.count, 1);
  const math = rows.find(row => row.label === "数学");
  assert.equal(math?.count, 1);
  assert.ok(rows.every(row => row.percent >= 0 && row.percent <= 100));
});

test("grade distribution counts school-wide exams for every grade and scopes grade admins", () => {
  const all = buildGradeDistribution(collectScopedItems(majors, grades, classes, allScope), grades);
  const g1 = all.find(row => row.label === "高一");
  const g2 = all.find(row => row.label === "高二");
  assert.equal(g1?.count, 4); // i-all + i-g1 + i-c1 + i-ended(全校)
  assert.equal(g2?.count, 3); // i-all + i-g2 + i-ended(全校)
  const scoped = buildGradeDistribution(collectScopedItems(majors, grades, classes, gradeAdminG1), grades, actorVisibleGradeIds(gradeAdminG1, grades));
  assert.deepEqual(scoped.map(row => row.label).sort(), ["高一"]);
});

test("classifyDevices counts raw online/in-exam, and scoped devices compose correctly", () => {
  const raw = classifyDevices(devices, now);
  assert.equal(raw.onlineDevices, 4); // d1、d3、d4、d5（纯计数，不含撤销/管理过滤）
  assert.equal(raw.inExamDevices, 2); // d1、d4
  const scoped = classifyDevices(scopedDevices(devices, allScope, classes), now);
  assert.equal(scoped.onlineDevices, 2); // d1、d3
  assert.equal(scoped.inExamDevices, 1); // 仅 d1
});

test("scopedDevices filters by grade scope, class scope, revoked and management", () => {
  const gradeDevices = scopedDevices(devices, gradeAdminG1, classes).map(device => device.instance_id).sort();
  assert.deepEqual(gradeDevices, ["d1", "d2"]); // g1 的 c1/c2，排除撤销/管理
  const classDevices = scopedDevices(devices, classAdminC1, classes).map(device => device.instance_id);
  assert.deepEqual(classDevices, ["d1"]);
});

test("scope label reflects all-school and grade scopes", () => {
  assert.equal(dashboardScopeLabel(allScope, grades), "全校数据大屏");
  assert.equal(dashboardScopeLabel(gradeAdminG1, grades), "高一数据大屏");
});
