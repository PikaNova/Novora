export interface OfficialHoliday {
  id: string;
  name: string;
  start: string;
  end: string;
}

// 2026 年数据来自国务院办公厅节假日安排通知。后续年份确认后再追加。
export const OFFICIAL_HOLIDAYS: OfficialHoliday[] = [
  { id: '2026-new-year', name: '元旦', start: '2026-01-01', end: '2026-01-03' },
  { id: '2026-spring-festival', name: '春节', start: '2026-02-15', end: '2026-02-23' },
  { id: '2026-qingming', name: '清明节', start: '2026-04-04', end: '2026-04-06' },
  { id: '2026-labour-day', name: '劳动节', start: '2026-05-01', end: '2026-05-05' },
  { id: '2026-dragon-boat', name: '端午节', start: '2026-06-19', end: '2026-06-21' },
  { id: '2026-mid-autumn', name: '中秋节', start: '2026-09-25', end: '2026-09-27' },
  { id: '2026-national-day', name: '国庆节', start: '2026-10-01', end: '2026-10-07' },
];

export function expandOfficialHolidayDates(): Set<string> {
  const dates = new Set<string>();
  for (const holiday of OFFICIAL_HOLIDAYS) {
    const cursor = new Date(`${holiday.start}T00:00:00Z`);
    const end = new Date(`${holiday.end}T00:00:00Z`);
    while (cursor <= end) {
      dates.add(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
  return dates;
}

export function getOfficialHolidayName(dateKey: string): string | null {
  return OFFICIAL_HOLIDAYS.find(item => dateKey >= item.start && dateKey <= item.end)?.name ?? null;
}
