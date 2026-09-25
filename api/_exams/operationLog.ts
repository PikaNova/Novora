import { randomUUID } from 'node:crypto';

/**
 * 非幂等动作（start / pause / resume / end / extend / promote …）没有客户端幂等键，
 * 但 `exam_record_operations.idempotency_key` 是主键，必须给一个合成键。
 * 幂等动作（copy / extend 带键）仍使用调用方提供的真实键。
 */
export function operationLogKey(recordId: string, action: string, at: number): string {
  return `op_${recordId}_${action}_${at}_${randomUUID().slice(0, 8)}`;
}
