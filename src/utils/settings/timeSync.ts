/** 从 src/utils/appSettings.ts 拆分出的时间同步领域设置。 */

export interface TimeSyncSettings {
	enabled: boolean;
	provider: 'httpDate' | 'timeApi' | 'ntp';
	httpDateUrl: string;
	timeApiUrl: string;
	ntpHost: string;
	ntpPort: number;
	manualOffsetMs: number;
	offsetMs: number;
	autoSyncEnabled: boolean;
	autoSyncIntervalSec: number;
	lastSyncAt: number;
	lastRttMs?: number;
	lastError?: string;
}

export const DEFAULT_TIME_SYNC_SETTINGS: TimeSyncSettings = {
	enabled: true,
	provider: 'timeApi',
	httpDateUrl: '/',
	timeApiUrl: '/api/time',
	ntpHost: 'ntp.aliyun.com',
	ntpPort: 123,
	manualOffsetMs: 0,
	offsetMs: 0,
	autoSyncEnabled: true,
	autoSyncIntervalSec: 900,
	lastSyncAt: 0,
};
