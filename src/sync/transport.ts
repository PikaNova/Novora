// 同步传输层：把「什么时候跟服务端说话」从 UI 组件里抽出来，集中到传输实现。
//
// 当前只有 HTTP 轮询实现（心跳驱动 + 版本变化时按需拉快照）。本地部署后续改用 WSS，
// 需要实现同一组接口：start(handlers) 里接管连接与推送，把服务端推来的
// 版本 / 快照 / 命令分发给 handlers，UI 侧只关心副作用，不再关心传输方式。
import {
  deviceHeartbeatIntervalMs,
  type DeviceBinding,
  type DeviceCommand,
  type DeviceHeartbeatInput,
} from '../shared/deviceContracts';
import { jitteredIntervalMs } from '../shared/polling';
import { sendDeviceHeartbeat } from '../services/classBinding';
import { markEdgeCacheSupport } from '../services/examService';
import { getResolvedExamItems } from '../utils/appSchedule';
import { getAppSettings } from '../utils/appSettings';
import { getTemporaryExam } from '../services/temporaryExam';
import { APP_VERSION } from '../services/telemetry';
import { nowMs, parseZonedTime } from '../utils/timeSource';

export type SyncTransportKind = 'http-poll' | 'wss';

export type HeartbeatOutcome = {
  revoked: boolean;
  binding: DeviceBinding | null;
  command: DeviceCommand | null;
  /** 服务端当前快照版本；只有启用了版本驱动同步的部署（Vercel）才会返回。 */
  version?: number;
};

export type SyncHandlers = {
  /** 每轮开始（可用于顺带发送插件心跳等附属请求）。 */
  onTick?: () => void;
  onVersion?: (version: number) => void;
  onCommand?: (command: DeviceCommand) => void;
  onBinding?: (binding: DeviceBinding) => void;
  onRevoked?: () => void;
};

export interface SyncTransport {
  readonly kind: SyncTransportKind;
  start(handlers: SyncHandlers): void;
  stop(handlers: SyncHandlers): void;
  /** 立即跑一轮（页面重新可见、联网恢复、手动刷新）。 */
  tick(): void;
  /** 命令执行完后登记回执，随下一次心跳上报。 */
  noteCommandAcknowledged(commandId: string): void;
  /** 单独发一次心跳并返回结果。 */
  heartbeat(): Promise<HeartbeatOutcome>;
}

export type HttpPollTransportDeps = {
  sendHeartbeat: (input: DeviceHeartbeatInput) => Promise<HeartbeatOutcome>;
  buildInput: (state: { page: string; acknowledgedCommandId: string }) => DeviceHeartbeatInput;
  intervalMsFor: (state: { temporaryActive: boolean; hasCurrentExam: boolean }) => number;
  now: () => number;
  setTimer: (callback: () => void, delayMs: number) => number;
  clearTimer: (handle: number) => void;
  random?: () => number;
  onVersionAdvertised?: () => void;
  currentPage?: () => string;
};

const EMPTY_OUTCOME: HeartbeatOutcome = { revoked: false, binding: null, command: null };
// 执行完命令后补发一次心跳做快速回执，与抽取前的行为保持一致。
const COMMAND_ACK_FOLLOW_UP_MS = 250;

/** 默认的心跳请求体：与改造前 DeviceHeartbeat 里组装的内容一致。 */
export function buildDeviceHeartbeatInput(state: {
  page: string;
  acknowledgedCommandId: string;
}): DeviceHeartbeatInput {
  const now = nowMs();
  const items = getResolvedExamItems(now);
  const current = items.find(
    (item) => item.enabled && parseZonedTime(item.startTime) <= now && parseZonedTime(item.endTime) > now,
  );
  const next = current ?? items.find((item) => item.enabled && parseZonedTime(item.startTime) > now);
  const settings = getAppSettings();
  const temporary = getTemporaryExam();
  const temporaryActive = temporary && temporary.status !== 'ended' && new Date(temporary.endTime).getTime() > now;
  const reportedExam = current ?? next;
  const reportedKind = reportedExam?.kind;
  const reportedExamName = !reportedExam
    ? ''
    : reportedKind === 'temporary'
      ? `${reportedExam.name} - 临时考试`
      : reportedKind === 'weekly'
        ? '周测'
        : reportedExam.majorName || settings.exam.title || '大型考试';
  return {
    page: state.page,
    clientVersion: APP_VERSION,
    status:
      temporaryActive && temporary.status === 'paused'
        ? 'temporary-paused'
        : current
          ? 'exam-running'
          : next
            ? 'waiting'
            : 'idle',
    currentExam: reportedExamName,
    currentSubject: reportedExam?.name ?? '',
    examStart: reportedExam?.startTime ?? '',
    examEnd: reportedExam?.endTime ?? '',
    acknowledgedCommandId: state.acknowledgedCommandId,
  };
}

/** 心跳节奏：考试中或临时考试期间更密，其余时间降频。 */
export function heartbeatIntervalMs(state: { temporaryActive: boolean; hasCurrentExam: boolean }): number {
  return deviceHeartbeatIntervalMs(state);
}

export function createHttpPollTransport(deps: HttpPollTransportDeps): SyncTransport {
  const handlers = new Set<SyncHandlers>();
  const random = deps.random ?? Math.random;
  const currentPage = deps.currentPage ?? (() => window.location.pathname);
  const onVersionAdvertised = deps.onVersionAdvertised ?? markEdgeCacheSupport;
  let timer: number | null = null;
  let inFlight = false;
  let acknowledgedCommandId = '';
  let edgeCapabilityMarked = false;

  const clearScheduled = () => {
    if (timer !== null) {
      deps.clearTimer(timer);
      timer = null;
    }
  };

  const schedule = () => {
    if (!handlers.size) return;
    clearScheduled();
    const now = deps.now();
    const items = getResolvedExamItems(now);
    const current = items.find(
      (item) => item.enabled && parseZonedTime(item.startTime) <= now && parseZonedTime(item.endTime) > now,
    );
    const temporary = getTemporaryExam();
    const temporaryActive = !!temporary && temporary.status !== 'ended' && new Date(temporary.endTime).getTime() > now;
    const base = deps.intervalMsFor({ temporaryActive, hasCurrentExam: Boolean(current) });
    timer = deps.setTimer(runCycle, jitteredIntervalMs(base, random));
  };

  const runCycle = async () => {
    if (!handlers.size || inFlight) return;
    inFlight = true;
    const listeners = [...handlers];
    try {
      for (const listener of listeners) listener.onTick?.();
      const input = deps.buildInput({ page: currentPage(), acknowledgedCommandId });
      let outcome: HeartbeatOutcome;
      try {
        outcome = await deps.sendHeartbeat(input);
      } catch {
        outcome = EMPTY_OUTCOME;
      }
      if (outcome.revoked) {
        for (const listener of listeners) listener.onRevoked?.();
      } else if (outcome.binding) {
        for (const listener of listeners) listener.onBinding?.(outcome.binding);
      }
      if (typeof outcome.version === 'number' && Number.isFinite(outcome.version)) {
        // 只在第一次落盘，避免每轮心跳都写一次 localStorage。
        if (!edgeCapabilityMarked) {
          edgeCapabilityMarked = true;
          onVersionAdvertised();
        }
        for (const listener of listeners) listener.onVersion?.(outcome.version);
      }
      // 已回执过的命令可能因为边缘缓存或重试再次到达，这里做一次去重，
      // 避免同一条临时考试指令被重复执行。
      if (outcome.command && outcome.command.id !== acknowledgedCommandId) {
        for (const listener of listeners) listener.onCommand?.(outcome.command);
        // 回执要在命令执行之后发出：让出一次事件循环，等 handler 里的同步副作用跑完。
        if (handlers.size) {
          deps.setTimer(() => {
            void runCycle();
          }, COMMAND_ACK_FOLLOW_UP_MS);
        }
      }
    } finally {
      inFlight = false;
      schedule();
    }
  };

  return {
    kind: 'http-poll',
    start(listener) {
      const wasEmpty = handlers.size === 0;
      handlers.add(listener);
      if (wasEmpty) void runCycle();
    },
    stop(listener) {
      handlers.delete(listener);
      if (!handlers.size) clearScheduled();
    },
    tick() {
      void runCycle();
    },
    noteCommandAcknowledged(commandId) {
      acknowledgedCommandId = commandId;
    },
    async heartbeat() {
      try {
        return await deps.sendHeartbeat(deps.buildInput({ page: currentPage(), acknowledgedCommandId }));
      } catch {
        return EMPTY_OUTCOME;
      }
    },
  };
}

let transport: SyncTransport | null = null;

export function getSyncTransport(): SyncTransport {
  if (!transport) {
    transport = createHttpPollTransport({
      sendHeartbeat: sendDeviceHeartbeat,
      buildInput: buildDeviceHeartbeatInput,
      intervalMsFor: heartbeatIntervalMs,
      now: () => Date.now(),
      setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
      clearTimer: (handle) => window.clearTimeout(handle),
    });
  }
  return transport;
}

/** 注册同步回调；第一个订阅者启动传输，最后一个取消时停止。 */
export function subscribeToSync(handlers: SyncHandlers): () => void {
  const active = getSyncTransport();
  active.start(handlers);
  return () => active.stop(handlers);
}

/** 仅测试与部署切换时使用。 */
export function setSyncTransportForTests(next: SyncTransport | null): void {
  transport = next;
}
