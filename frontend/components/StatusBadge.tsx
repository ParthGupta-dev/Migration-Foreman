import { formatUnitStatusLabel, unitStatusBadgeClasses } from "@/utils/formatUnitStatus";

export default function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${unitStatusBadgeClasses(
        status
      )}`}
    >
      {formatUnitStatusLabel(status)}
    </span>
  );
}
