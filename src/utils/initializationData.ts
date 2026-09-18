import type { MajorExam } from '../types';
import type { ScheduleMode, WeeklyPlan, WeeklyWeekMode } from '../types/exam';
import type { SchoolClass, SchoolGrade } from '../types/school';
import { addDaysToDateKey, createEmptyWeeklyPlan, getShanghaiDateKey } from './weeklySchedule';
import { DEFAULT_SEO_SETTINGS, type SeoSettings } from './settings/school';

export interface SchoolDraftRow {
  name: string;
  classes: string;
}
export interface InitializationResult {
  grades: SchoolGrade[];
  classes: SchoolClass[];
  majors: MajorExam[];
  activeMajorId: string;
  weeklyPlans: WeeklyPlan[];
  activeWeeklyPlanId: string | null;
  activeWeeklyPlanIdByClassId: Record<string, string | null>;
  scheduleMode: ScheduleMode;
  selectedGradeId: string;
  selectedClassId: string;
  initialization: {
    completedAt: number;
    wizardVersion: number;
    demoDataImported: boolean;
    province: string;
    schoolName: string;
    schoolFullName: string;
    schoolLogo?: string;
    subjectTrackModeEnabled: boolean;
    seo: SeoSettings;
  };
}

const cleanNames = (value: string) =>
  value
    .split(/[，,、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

export function buildInitializationData(options: {
  mode: 'blank' | 'demo';
  school: SchoolDraftRow[];
  termStart: string;
  weekMode: WeeklyWeekMode;
  excludeOfficialHolidays: boolean;
  scheduleMode: ScheduleMode;
  schoolName: string;
  province: string;
  schoolLogo?: string;
  subjectTrackModeEnabled?: boolean;
  seo?: Partial<SeoSettings>;
}): InitializationResult {
  const stamp = Date.now();
  const prefix = options.mode === 'demo' ? 'demo' : 'school';
  const rows = options.school.filter((row) => row.name.trim() && cleanNames(row.classes).length);
  const grades: SchoolGrade[] = rows.map((row, order) => ({
    id: `${prefix}_grade_${stamp}_${order}`,
    name: row.name.trim(),
    order,
    enabled: true,
  }));
  const classes: SchoolClass[] = rows.flatMap((row, gradeIndex) =>
    cleanNames(row.classes).map((name, order) => ({
      id: `${prefix}_class_${stamp}_${gradeIndex}_${order}`,
      gradeId: grades[gradeIndex].id,
      name,
      order,
      enabled: true,
    })),
  );
  const today = getShanghaiDateKey(Date.now());
  const tomorrow = addDaysToDateKey(today, 1);
  const targetGrade = grades[grades.length - 1];
  // 初始化不再生成默认考试：教室端与考试中心第一眼看到的应该是空态，
  // 而不是一条创建人写着「系统」的占位考试（那条记录以前会一直躺在列表里，
  // dev 上用户反馈的「不是我创建的考试」之一就是它）。演示模式仍给一份带科目的示例。
  const majors: MajorExam[] =
    options.mode === 'demo'
      ? [
          {
            id: `${prefix}_major_${stamp}`,
            name: `${targetGrade?.name ?? '高三'}阶段测试（演示）`,
            order: 0,
            targetGradeIds: targetGrade ? [targetGrade.id] : [],
            items: [
              {
                id: `demo_exam_${stamp}_0`,
                name: '语文',
                startTime: `${tomorrow}T08:30:00`,
                endTime: `${tomorrow}T10:30:00`,
                enabled: true,
                order: 0,
              },
              {
                id: `demo_exam_${stamp}_1`,
                name: '数学',
                startTime: `${tomorrow}T14:00:00`,
                endTime: `${tomorrow}T16:00:00`,
                enabled: true,
                order: 1,
              },
              {
                id: `demo_exam_${stamp}_2`,
                name: '外语',
                startTime: `${addDaysToDateKey(tomorrow, 1)}T08:30:00`,
                endTime: `${addDaysToDateKey(tomorrow, 1)}T10:00:00`,
                enabled: true,
                order: 2,
              },
            ],
          },
        ]
      : [];

  const weeklyPlans: WeeklyPlan[] =
    options.mode === 'demo'
      ? classes.slice(0, Math.min(2, classes.length)).map((schoolClass, order) => {
          const grade = grades.find((item) => item.id === schoolClass.gradeId)!;
          const base = createEmptyWeeklyPlan(Date.now(), `${grade.name}${schoolClass.name}周测（演示）`);
          return {
            ...base,
            id: `demo_weekly_${stamp}_${order}`,
            gradeId: grade.id,
            classId: schoolClass.id,
            anchorDate: options.termStart,
            activeFrom: options.termStart,
            weekMode: options.weekMode,
            excludeOfficialHolidays: options.excludeOfficialHolidays,
            order,
            items: [
              {
                id: `demo_weekly_item_${stamp}_${order}_0`,
                name: order === 0 ? '数学周测' : '外语周测',
                weekday: order === 0 ? 3 : 4,
                startTime: '19:00',
                endTime: '20:00',
                enabled: true,
                order: 0,
                weekType: options.weekMode === 'ab' ? (order === 0 ? 'a' : 'b') : 'all',
              },
            ],
          };
        })
      : [];
  const activeWeeklyPlanIdByClassId = Object.fromEntries(
    classes.map((item) => [item.id, weeklyPlans.find((plan) => plan.classId === item.id)?.id ?? null]),
  );
  return {
    grades,
    classes,
    majors,
    activeMajorId: majors[0]?.id ?? '',
    weeklyPlans,
    activeWeeklyPlanId: weeklyPlans[0]?.id ?? null,
    activeWeeklyPlanIdByClassId,
    scheduleMode: options.scheduleMode,
    selectedGradeId: '',
    selectedClassId: '',
    initialization: {
      completedAt: Date.now(),
      wizardVersion: 2,
      demoDataImported: options.mode === 'demo',
      province: options.province.trim(),
      schoolName: options.schoolName.trim(),
      schoolFullName: `${options.province.trim()}${options.schoolName.trim()}`,
      schoolLogo: options.schoolLogo ?? '',
      subjectTrackModeEnabled: options.subjectTrackModeEnabled === true,
      seo: { ...DEFAULT_SEO_SETTINGS, ...(options.seo ?? {}) },
    },
  };
}
