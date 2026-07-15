import { ArrowLeft } from "lucide-react";
import type { ReactNode, Ref } from "react";

export const StepHeading = ({
  eyebrow,
  title,
  ref
}: {
  eyebrow: string;
  title: string;
  ref: Ref<HTMLHeadingElement>;
}) => (
  <div className="onboarding-heading">
    <span>{eyebrow}</span>
    <h1 id="onboarding-title" ref={ref} tabIndex={-1}>
      {title}
    </h1>
  </div>
);

export function StepActions({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  return (
    <div className="onboarding-actions">
      <button type="button" className="onboarding-back" onClick={onBack}>
        <ArrowLeft size={16} /> Back
      </button>
      {children}
    </div>
  );
}

export function Field({
  id,
  label,
  hint,
  children
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="onboarding-field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <small>{hint}</small>}
    </div>
  );
}
