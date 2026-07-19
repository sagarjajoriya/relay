import type { WorkspaceRole } from "@relay/contracts";

const STYLES: Record<WorkspaceRole, string> = {
  OWNER: "bg-emerald-100 text-emerald-800",
  ADMIN: "bg-indigo-100 text-indigo-800",
  MEMBER: "bg-gray-100 text-gray-600",
};

export function RoleBadge({ role }: { role: WorkspaceRole }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${STYLES[role]}`}>{role}</span>
  );
}
