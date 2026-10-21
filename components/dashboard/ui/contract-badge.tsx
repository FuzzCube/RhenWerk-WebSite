import { contractBadge, type ContractRow } from "@/lib/service-contract";

// SLA contract as a status badge (task-16-3): "SLA 24/7", "SLA", "SLA abgelaufen", "SLA ab …"; the text alone is sufficient
export function ContractBadge({ contract, today }: { contract: Pick<ContractRow, "emergency_24_7" | "valid_from" | "valid_until">; today: string }) {
  const { label, tone } = contractBadge(contract, today);
  return (
    <span className={`status-badge status-badge--${tone}`} data-sla={label}>
      <span className="status-badge__dot" aria-hidden="true" />
      {label}
    </span>
  );
}
