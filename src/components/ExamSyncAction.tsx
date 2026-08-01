import type { ExamDataSyncState } from "../hooks/useExamSync";
import { AlertTriangle, LoaderCircle, RefreshCw } from "lucide-react";
import {
  labelForExamSync,
  needsUrgentAttention,
  statusForExamSync,
} from "../utils/examSyncStatus";

interface Props {
  state: ExamDataSyncState;
  lastSyncAt: number;
  hasPendingSync: boolean;
  onRefresh: () => void;
  syncError?: string;
}

export default function ExamSyncAction({
  state,
  lastSyncAt,
  hasPendingSync,
  onRefresh,
  syncError,
}: Props) {
  const busy = state === "syncing";
  const needsAttention = needsUrgentAttention(state);
  return (
    <div className={`exam-sync-action is-${state}${hasPendingSync ? " has-pending" : ""}${needsAttention ? " needs-attention" : ""}`}>
      <button type="button" className="exam-sync-action__button" onClick={onRefresh} disabled={busy} aria-label="重新载入考试数据">
        {busy ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : needsAttention ? <AlertTriangle aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
        {labelForExamSync(state, hasPendingSync)}
      </button>
      <span className="exam-sync-action__status">
        {statusForExamSync(state, lastSyncAt, hasPendingSync, syncError)}
      </span>
    </div>
  );
}
