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
  /** 最近一次成功校时的本机 Unix 时间（用于旧版本兼容和无单调锚点时的回退）。 */
  lastSyncAt: number;
  /** 最近一次成功校时对应的服务端时间，用于跨设备时钟异常时展示可靠时间。 */
  lastSyncServerAt?: number;
  /** 最近一次成功校时对应的会话单调时钟读数。 */
  lastSyncMonotonicMs?: number;
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
