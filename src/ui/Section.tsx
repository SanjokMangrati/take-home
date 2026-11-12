import "./Section.css";
import { type ReactNode, type Ref, useId } from "react";

interface SectionProps {
  readonly title: ReactNode;
  readonly lead?: ReactNode;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly ref?: Ref<HTMLElement> | undefined;
}

export function Section({ title, lead, actions, children, ref }: SectionProps) {
  const headingId = useId();
  return (
    <section ref={ref} className="section" aria-labelledby={headingId}>
      <div className="section-head">
        <div>
          <h2 id={headingId}>{title}</h2>
          {lead !== undefined && <p className="section-lead">{lead}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
