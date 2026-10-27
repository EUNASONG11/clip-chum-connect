import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Unlock, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ClearableSearchInput } from "@/components/admin/ClearableSearchInput";
import { VideoThumb } from "@/components/VideoThumb";
import { getVideoUnlockStates, setVideoUnlocks } from "@/lib/video-unlocks.functions";
import { matchesUnlockStudent, orderedUnlockVideos, type AccessState } from "@/lib/video-unlock-model";
import { VideoAccessBadge } from "@/components/admin/VideoAccessBadge";
import { formatWeekLabel } from "@/lib/week";

export function VideoUnlockDialog({ classId, userIds, names, open, onClose }: { classId: string; userIds: string[]; names: string[]; open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [expandedVideos, setExpandedVideos] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const load = useServerFn(getVideoUnlockStates);
  const save = useServerFn(setVideoUnlocks);
  const qc = useQueryClient();
  const { data, isPending, error } = useQuery({ queryKey: ["video-unlocks", classId, [...userIds].sort()], queryFn: () => load({ data: { classId, userIds } }), enabled: open });
  const rows = useMemo(() => orderedUnlockVideos(data?.videos ?? [], data?.folders ?? []).filter(({ video }) => video.title.toLowerCase().includes(query.trim().toLowerCase())), [data, query]);
  const counts = new Map<string, { locked: number; unlocked: number }>();
  for (const state of data?.states ?? []) {
    const count = counts.get(state.video_id) ?? { locked: 0, unlocked: 0 };
    if (state.state === "locked") count.locked++;
    if (state.state === "unlocked") count.unlocked++;
    counts.set(state.video_id, count);
  }
  const lockedCount = [...selection].reduce((sum, id) => sum + (counts.get(id)?.locked ?? 0), 0);
  const unlockedCount = [...selection].reduce((sum, id) => sum + (counts.get(id)?.unlocked ?? 0), 0);
  const lockedStudentsByVideo = useMemo(() => {
    const students = new Map((data?.students ?? []).map((student) => [student.user_id, student]));
    const byVideo = new Map<string, NonNullable<typeof data>["students"]>();
    for (const state of data?.states ?? []) {
      if (state.state !== "locked") continue;
      const student = students.get(state.user_id);
      if (!student) continue;
      const list = byVideo.get(state.video_id) ?? [];
      list.push(student);
      byVideo.set(state.video_id, list);
    }
    for (const list of byVideo.values()) list.sort((a, b) => a.name.localeCompare(b.name, "ko"));
    return byVideo;
  }, [data]);
  const apply = async (unlock: boolean) => {
    setSaving(true);
    try {
      const result = await save({ data: { classId, userIds, videoIds: [...selection], unlock } });
      toast.success(`${result.affected}건의 개별 열기를 ${unlock ? "적용" : "해제"}했습니다.`);
      await qc.invalidateQueries();
      onClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : "처리에 실패했습니다."); }
    finally { setSaving(false); }
  };
  return <Dialog open={open} onOpenChange={(value) => { if (!value && !saving) onClose(); }}>
    <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-4xl">
      <DialogHeader><DialogTitle className="flex items-center gap-2"><Unlock className="h-5 w-5" />영상 개별 열기</DialogTitle>
        <DialogDescription>선택 학생 {userIds.length}명 · {names.slice(0, 4).join(", ")}{names.length > 4 ? " 외" : ""}</DialogDescription>
      </DialogHeader>
      <div className="space-y-1 text-xs text-muted-foreground">
        <p>잠긴 영상을 골라 선택한 학생에게 열어 줍니다.</p>
        <p>한 번 연 영상은 시작 주차를 바꿔도 계속 열려 있고 학습 현황 집계에 포함됩니다.</p>
        <p>숨김 처리된 영상은 열어도 보이지 않습니다. 숨김이 우선합니다.</p>
        {!!data?.excluded_count && <p className="text-destructive">다른 교육원 학생 {data.excluded_count}명은 제외됩니다.</p>}
      </div>
      <ClearableSearchInput value={query} onChange={setQuery} placeholder="영상 제목 검색" />
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {isPending ? <p className="flex items-center gap-2 py-6"><Loader2 className="h-4 w-4 animate-spin" />불러오는 중...</p> : error ? <p role="alert" className="text-destructive">{error.message}</p> : rows.length === 0 ? <p className="py-6 text-sm text-muted-foreground">대상 영상이 없습니다.</p> : rows.map(({ video, path }, index) => {
          const count = counts.get(video.id) ?? { locked: 0, unlocked: 0 };
          const disabled = count.locked + count.unlocked === 0;
          const date = new Date(video.created_at).toLocaleDateString("en-US", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit" }).replace("/", ".");
          return <div key={video.id}>
            {(index === 0 || rows[index - 1]?.path !== path) && <p className="mb-2 mt-3 text-xs font-semibold">{path}</p>}
            <div className={`flex flex-wrap items-center gap-3 rounded-md border p-3 ${disabled ? "bg-access-neutral/60 text-muted-foreground opacity-60" : selection.has(video.id) ? "border-primary bg-accent/40" : "bg-background"}`}>
              <label className={`flex min-w-0 flex-1 items-center gap-3 ${disabled ? "" : "cursor-pointer"}`}>
              <Checkbox aria-label={`영상 선택 ${video.title}`} checked={selection.has(video.id)} disabled={disabled || saving} onCheckedChange={(checked) => setSelection((old) => { const next = new Set(old); if (checked) next.add(video.id); else next.delete(video.id); return next; })} />
              <div className="aspect-video w-20 shrink-0 overflow-hidden rounded bg-muted"><VideoThumb src={video.thumbnail_url} alt={video.title} className="h-full w-full object-cover" /></div>
              <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{video.title}</p><p className="mt-1 text-xs text-muted-foreground">{video.week_label ? formatWeekLabel(video.week_label) : "주차 없음"} · 업로드 {date}</p>
              </div>
              </label>
              <div className="ml-auto flex max-w-full justify-end">
                {count.locked ? <Button type="button" variant="ghost" className="h-auto gap-1 p-0" aria-label={`잠긴 학생 보기 ${video.title}`} aria-expanded={expandedVideos.has(video.id)} aria-controls={`locked-students-${video.id}`} onClick={() => setExpandedVideos((old) => { const next = new Set(old); if (next.has(video.id)) next.delete(video.id); else next.add(video.id); return next; })}>
                  <VideoAccessBadge state="locked" detail={`${data?.students.length ?? 0}명 중 ${count.locked}명`} />
                  {expandedVideos.has(video.id) ? <ChevronUp aria-hidden="true" className="h-3.5 w-3.5" /> : <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />}
                </Button> : <VideoAccessBadge state={count.unlocked ? "unlocked" : "not_locked"} detail={count.unlocked ? `${count.unlocked}명` : undefined} />}
              </div>
              {count.locked > 0 && expandedVideos.has(video.id) && <div id={`locked-students-${video.id}`} role="region" aria-label={`잠긴 학생 ${video.title}`} className="w-full border-t pt-3">
                <p className="mb-2 text-xs font-medium">잠긴 학생 {count.locked}명</p>
                <ul className="max-h-48 space-y-2 overflow-y-auto">
                  {(lockedStudentsByVideo.get(video.id) ?? []).map((student) => <li key={student.user_id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="break-words font-medium">{student.name}</span>
                    <span className="break-words text-xs text-muted-foreground">{[student.school, student.grade, student.branch].filter(Boolean).join(" · ")}</span>
                  </li>)}
                </ul>
              </div>}
            </div>
          </div>;
        })}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
        <p className="mr-auto w-full text-xs text-muted-foreground sm:w-auto">영상 {selection.size}개 선택 · 잠긴 학생 {lockedCount}건이 열립니다</p>
        <Button variant="outline" disabled={saving} onClick={onClose}>취소</Button>
        <Button variant="outline" disabled={saving || selection.size === 0 || unlockedCount === 0} onClick={() => apply(false)}>선택 영상 열기 해제</Button>
        <Button disabled={saving || lockedCount === 0} onClick={() => apply(true)}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}선택 영상 열기</Button>
      </div>
    </DialogContent>
  </Dialog>;
}

export function VideoUnlockPanel({ classId, videoId, query }: { classId: string; videoId: string; query: string }) {
  const [filter, setFilter] = useState<"all" | "locked" | "unlocked">("all");
  const [saving, setSaving] = useState(false);
  const load = useServerFn(getVideoUnlockStates);
  const save = useServerFn(setVideoUnlocks);
  const qc = useQueryClient();
  const { data, isPending, error } = useQuery({ queryKey: ["video-unlocks", classId, videoId], queryFn: () => load({ data: { classId, videoIds: [videoId] } }) });
  const states = new Map((data?.states ?? []).map((s) => [s.user_id, s.state]));
  const students = (data?.students ?? []).filter((s) => matchesUnlockStudent(s, query));
  const count = (state: AccessState) => students.filter((s) => states.get(s.user_id) === state).length;
  const totalUnlocked = (data?.states ?? []).filter((s) => s.state === "unlocked").length;
  const toggle = async (userId: string, unlock: boolean) => {
    setSaving(true);
    try {
      await save({ data: { classId, userIds: [userId], videoIds: [videoId], unlock } });
      await qc.invalidateQueries();
      toast.success(unlock ? "영상을 개별로 열었습니다." : "개별 열기를 해제했습니다.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "처리에 실패했습니다."); }
    finally { setSaving(false); }
  };
  return <div className="min-w-0 rounded-md border p-3">
    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-medium"><Unlock className="h-3.5 w-3.5" />학생별 개별 열기<span className="rounded bg-accent px-1.5 py-0.5 text-accent-foreground">{totalUnlocked}명 개별 열기</span></div>
    <div className="mb-2 flex flex-wrap gap-1">{([['all', '전체', students.length], ['locked', '잠김', count('locked')], ['unlocked', '개별 열기됨', count('unlocked')]] as const).map(([key, label, n]) => <Button key={key} size="sm" variant={filter === key ? "secondary" : "ghost"} className="h-7 text-xs" onClick={() => setFilter(key)}>{label} {n}</Button>)}</div>
    {isPending ? <p className="flex items-center gap-1 text-xs"><Loader2 className="h-3 w-3 animate-spin" />불러오는 중...</p> : error ? <p role="alert" className="text-xs text-destructive">{error.message}</p> : <div className="max-h-48 space-y-1 overflow-y-auto">
      {students.filter((s) => filter === "all" || states.get(s.user_id) === filter).map((s) => {
        const state = states.get(s.user_id) ?? "not_locked";
        const disabled = state === "hidden" || state === "not_locked";
        return <label key={s.user_id} className={`flex flex-wrap items-center gap-2 rounded p-2 ${disabled ? "text-muted-foreground opacity-60" : "cursor-pointer hover:bg-muted"}`}><Checkbox aria-label={`개별 열기 ${s.name}`} checked={state === "unlocked"} disabled={disabled || saving} onCheckedChange={(checked) => toggle(s.user_id, checked === true)} /><div className="min-w-0 flex-1"><p className="break-words text-sm">{s.name}<span className="ml-1 text-xs text-muted-foreground">{[s.school, s.grade, s.branch].filter(Boolean).join(" · ")}</span></p></div><div className="ml-auto flex max-w-full justify-end"><VideoAccessBadge state={state} /></div></label>;
      })}
      {students.length === 0 && <p className="text-xs text-muted-foreground">대상 학생이 없습니다.</p>}
    </div>}
    <p className="mt-2 text-[11px] text-muted-foreground">체크한 학생에게는 시작 주차·배정 시점과 관계없이 이 영상이 열리고, 학습 현황 집계에 포함됩니다. 이미 열려 있는 학생은 '잠금 대상 아님', 숨김 처리된 학생은 숨김이 우선합니다.</p>
  </div>;
}