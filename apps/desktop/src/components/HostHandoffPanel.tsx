import { Check } from "lucide-react";

export interface HostHandoffDisplay {
  id: string;
  status: "available" | "accepted";
  fromHost: string;
  messagesSinceLastCodex: number;
  attachmentNames: string[];
  terminals: string[];
  projectPath: string;
  codexModel: string;
}

export function HostHandoffPanel<T extends HostHandoffDisplay>({
  handoffs,
  acceptDisabled,
  onAcceptHandoff,
  formatModel
}: {
  handoffs: T[];
  acceptDisabled: boolean;
  onAcceptHandoff: (handoff: T) => void;
  formatModel: (model: string) => string;
}) {
  const hasAvailableHandoff = handoffs.some((handoff) => handoff.status === "available");

  return (
    <section className="panel handoff-panel">
      <div className="panel-title">
        <span>Host handoff</span>
        <small className={hasAvailableHandoff ? "panel-state attention" : "panel-state"}>
          {hasAvailableHandoff ? "Available" : "None"}
        </small>
      </div>
      <div className="handoff-list">
        {handoffs.slice(-3).reverse().map((handoff) => (
          <div className={`handoff-row ${handoff.status}`} key={handoff.id}>
            <div>
              <strong>{handoff.fromHost}</strong>
              <span>{handoff.messagesSinceLastCodex} messages · {handoff.attachmentNames.length} attachments · {handoff.terminals.length} terminals</span>
              <small>{handoff.projectPath} · {formatModel(handoff.codexModel)}</small>
            </div>
            {handoff.status === "available" ? (
              <button onClick={() => onAcceptHandoff(handoff)} disabled={acceptDisabled}>
                <Check size={13} />
                Accept
              </button>
            ) : (
              <b>{handoff.status}</b>
            )}
          </div>
        ))}
        {handoffs.length === 0 && (
          <div className="empty-state compact">No host handoff package for this room.</div>
        )}
      </div>
    </section>
  );
}
