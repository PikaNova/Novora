import { Check } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

type Step = {
  label: string;
  hint?: string;
};

export default function AdminWizardSteps({
  steps,
  active,
  summary,
}: {
  steps: Step[];
  active: number;
  summary?: ReactNode;
}) {
  return (
    <aside className="admin-wizard-steps" aria-label="操作步骤" style={{ "--admin-wizard-step-count": steps.length } as CSSProperties}>
      <div className="admin-wizard-steps__list">
        {steps.map((step, index) => (
          <div
            key={step.label}
            className={index === active ? "is-active" : index < active ? "is-done" : ""}
            aria-current={index === active ? "step" : undefined}
          >
            <i>{index < active ? <Check aria-hidden="true" /> : index + 1}</i>
            <span><strong>{step.label}</strong>{step.hint && <small>{step.hint}</small>}</span>
          </div>
        ))}
      </div>
      {summary && <div className="admin-wizard-steps__summary">{summary}</div>}
    </aside>
  );
}
