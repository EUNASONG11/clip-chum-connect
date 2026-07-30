import { cn } from "@/lib/utils";

/** 교육원별 고유 색상 뱃지 (상동 · 청라 · 송도) */
const BRANCH_CLASS: Record<string, string> = {
  상동: "bg-branch-sangdong text-white border-transparent",
  청라: "bg-branch-cheongna text-white border-transparent",
  송도: "bg-branch-songdo text-white border-transparent",
};

export function BranchBadge({
  branch,
  className,
}: {
  branch?: string | null;
  className?: string;
}) {
  const name = (branch ?? "").trim();
  if (!name) return null;
  const key = Object.keys(BRANCH_CLASS).find((k) => name.includes(k));
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold leading-none",
        key ? BRANCH_CLASS[key] : "bg-muted text-muted-foreground",
        className,
      )}
    >
      {name}
    </span>
  );
}
