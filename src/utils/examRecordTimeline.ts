/**
 * 考试详情「生命周期」的阶段构造。
 *
 * 阶段时间优先取记录层的列（published_at / actual_start_at / ...），
 * 列里没有时用操作日志兜底：09/18 那批老记录发布时快照里还没有 publishedAt，
 * 所以记录层是空的、日志里却有 publish，界面会显示成「已发布但生命周期没发布」。
 */

export type ExamTimelineRecordLike = {
  createdAt: number;
  publishedAt: number | null;
  actualStartAt: number | null;
  actualEndAt: number | null;
  endedAt: number | null;
  archivedAt: number | null;
  /** 「申请停止」的时刻：这时考试还没结束，等系统判定，时间线上要标出来。 */
  stopRequestedAt?: number | null;
};

export type ExamTimelineOperationLike = {
  action: string;
  createdAt: number;
  actorName?: string;
};

export type ExamTimelineStage = {
  key: string;
  label: string;
  at: number | null;
  note?: string;
};

const PUBLISH_ACTIONS = ['publish'];
const START_ACTIONS = ['auto_start'];
const END_ACTIONS = ['end', 'auto_end', 'force_end'];
const ARCHIVE_ACTIONS = ['archive', 'auto_archive'];

export function buildExamRecordTimeline(
  record: ExamTimelineRecordLike,
  operations: readonly ExamTimelineOperationLike[],
): ExamTimelineStage[] {
  const earliest = (actions: readonly string[]): number | null => {
    const hits = operations
      .filter((entry) => actions.includes(entry.action))
      .map((entry) => entry.createdAt)
      .filter((value) => Number.isFinite(value) && value > 0);
    return hits.length ? Math.min(...hits) : null;
  };
  // 暂停/继续可能来回多次，按发生顺序展开成独立阶段。
  const pauseStages: ExamTimelineStage[] = operations
    .filter((entry) => entry.action === 'pause' || entry.action === 'resume')
    .sort((left, right) => left.createdAt - right.createdAt)
    .map((entry) => ({
      key: `${entry.action}-${entry.createdAt}`,
      label: entry.action === 'pause' ? '暂停' : '继续',
      at: entry.createdAt,
      note: entry.actorName || undefined,
    }));
  return [
    { key: 'created', label: '创建', at: record.createdAt },
    { key: 'published', label: '发布', at: record.publishedAt ?? earliest(PUBLISH_ACTIONS) },
    { key: 'started', label: '开考', at: record.actualStartAt ?? earliest(START_ACTIONS) },
    ...(record.stopRequestedAt != null
      ? [
          {
            key: 'stop-requested',
            label: '申请停止',
            at: record.stopRequestedAt,
            note: '等待系统判定（到结束时间 / 教室端全部结束 / 长时间无在线设备）',
          } satisfies ExamTimelineStage,
        ]
      : []),
    ...pauseStages,
    {
      key: 'ended',
      label: '结束',
      at: record.actualEndAt ?? record.endedAt ?? earliest(END_ACTIONS),
    },
    { key: 'archived', label: '归档', at: record.archivedAt ?? earliest(ARCHIVE_ACTIONS) },
  ];
}
