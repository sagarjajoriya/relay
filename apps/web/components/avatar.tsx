// Initials-based avatars per the design spec (no photos). Color is a stable
// hash of the name so the same user is always the same hue everywhere.
const PALETTE = [
  "bg-indigo-500",
  "bg-emerald-500",
  "bg-rose-500",
  "bg-amber-500",
  "bg-sky-500",
  "bg-violet-500",
  "bg-teal-500",
  "bg-fuchsia-500",
];

function hashColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function Avatar({
  name,
  size = "md",
  online,
}: {
  name: string;
  size?: "sm" | "md";
  online?: boolean;
}) {
  const dims = size === "sm" ? "h-6 w-6 text-[10px]" : "h-9 w-9 text-xs";
  return (
    <span className={`relative inline-flex shrink-0 ${dims}`}>
      <span
        className={`flex h-full w-full items-center justify-center rounded-lg font-semibold text-white ${hashColor(name)}`}
      >
        {initials(name)}
      </span>
      {online !== undefined && (
        <span
          className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card ${
            online ? "bg-success" : "border-ink-faint bg-card"
          }`}
        />
      )}
    </span>
  );
}
