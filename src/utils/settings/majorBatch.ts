/** 从 src/utils/appSettings.ts 拆分出的批量预设（自定义科目组/时间组）设置。 */

export interface MajorBatchSubjectGroup {
	id: string;
	name: string;
	subjects: string[];
	custom: true;
	updatedAt: number;
	order?: number;
}

export interface MajorBatchTimeSlot {
	start: string;
	end: string;
	dayOffset?: number;
}

export interface MajorBatchTimeGroup {
	id: string;
	name: string;
	slots: MajorBatchTimeSlot[];
	custom: true;
	updatedAt: number;
	order?: number;
}

export interface MajorBatchSettings {
	subjectGroups: MajorBatchSubjectGroup[];
	timeGroups: MajorBatchTimeGroup[];
}

export const DEFAULT_MAJOR_BATCH_SETTINGS: MajorBatchSettings = {
	subjectGroups: [],
	timeGroups: [],
};

const MAJOR_BATCH_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function genMajorBatchPresetId(prefix: string): string {
	return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function normalizeMajorBatchSubjectGroups(raw: unknown): MajorBatchSubjectGroup[] {
	const parsed = (Array.isArray(raw) ? raw : [])
		.filter(Boolean)
		.map((item, index) => {
			const source = item as Partial<MajorBatchSubjectGroup>;
			const subjects = Array.isArray(source.subjects)
				? [...new Set(source.subjects.map(value => String(value).trim()).filter(Boolean))]
				: [];
			return {
				id: String(source.id || genMajorBatchPresetId('batch_subject_group')),
				name: String(source.name || `自定义科目组 ${index + 1}`).trim(),
				subjects,
				custom: true as const,
				updatedAt: Number.isFinite(source.updatedAt) ? Number(source.updatedAt) : 0,
				order: Number.isFinite(source.order) ? Number(source.order) : index,
			};
		})
		.filter(item => item.name && item.subjects.length > 0)
		.sort((a, b) => a.order - b.order)
		.slice(0, 24);
	return parsed.map((item, index) => ({ ...item, order: index }));
}

function normalizeMajorBatchTimeSlots(raw: unknown): MajorBatchTimeSlot[] {
	return (Array.isArray(raw) ? raw : [])
		.filter(Boolean)
		.map((item) => {
			const source = item as Partial<MajorBatchTimeSlot>;
			const dayOffset = Number(source.dayOffset ?? 0);
			return {
				start: String(source.start ?? '').trim(),
				end: String(source.end ?? '').trim(),
				dayOffset: Number.isFinite(dayOffset) ? Math.max(0, Math.min(30, Math.round(dayOffset))) : 0,
			};
		})
		.filter(item => MAJOR_BATCH_TIME_RE.test(item.start) && MAJOR_BATCH_TIME_RE.test(item.end))
		.slice(0, 40);
}

export function normalizeMajorBatchSettings(raw: unknown): MajorBatchSettings {
	const source = (raw ?? {}) as Partial<MajorBatchSettings>;
	const parsedTimeGroups = (Array.isArray(source.timeGroups) ? source.timeGroups : [])
		.filter(Boolean)
		.map((item, index) => {
			const value = item as Partial<MajorBatchTimeGroup>;
			return {
				id: String(value.id || genMajorBatchPresetId('batch_time_group')),
				name: String(value.name || `自定义时间组 ${index + 1}`).trim(),
				slots: normalizeMajorBatchTimeSlots(value.slots),
				custom: true as const,
				updatedAt: Number.isFinite(value.updatedAt) ? Number(value.updatedAt) : 0,
				order: Number.isFinite(value.order) ? Number(value.order) : index,
			};
		})
		.filter(item => item.name && item.slots.length > 0)
		.sort((a, b) => a.order - b.order)
		.slice(0, 24);
	const timeGroups = parsedTimeGroups.map((item, index) => ({ ...item, order: index }));
	return {
		subjectGroups: normalizeMajorBatchSubjectGroups(source.subjectGroups),
		timeGroups,
	};
}
