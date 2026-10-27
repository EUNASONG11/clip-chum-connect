import { EyeOff, LockKeyhole, UnlockKeyhole } from "lucide-react";
import { accessLabels, type AccessState } from "@/lib/video-unlock-model";

export function VideoAccessBadge({ state, detail }: { state: AccessState; detail?: string }) {
  const Icon = state === "locked" ? LockKeyhole : state === "unlocked" ? UnlockKeyhole : state === "hidden" ? EyeOff : null;
  const tone = state === "locked" ? "bg-access-locked text-access-locked-foreground" : state === "unlocked" ? "bg-access-unlocked text-access-unlocked-foreground" : "bg-access-neutral text-access-neutral-foreground";
  return <span className={`inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${tone}`}>
    {Icon && <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
    <span className="break-words">{accessLabels[state]}{detail ? ` · ${detail}` : ""}</span>
  </span>;
}