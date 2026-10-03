import { useQuery } from "@tanstack/react-query";
import { Loader2, CheckCircle2, Circle, Folder } from "lucide-react";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { getStudentLearningDetail } from "@/lib/vimeo.functions";

function fmtDuration(sec: number | null | undefined) {
  if (!sec || sec <= 0) return "-";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}분 ${String(s).padStart(2, "0")}초`;
}

const NONE_KEY = "__none__";

export function StudentLearningDetail({ userId }: { userId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "student-detail", userId],
    queryFn: async () => await getStudentLearningDetail({ data: { userId } }),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> 학습 이력을 불러오는 중…
      </div>
    );
  }
  if (error) {
    return (
      <div className="px-4 py-6 text-sm text-destructive">
        {(error as any)?.message ?? "학습 이력을 불러오지 못했습니다."}
      </div>
    );
  }
  const classes = data?.classes ?? [];
  if (classes.length === 0) {
    return (
      <div className="px-4 py-6 text-sm text-muted-foreground">배정된 수강반이 없습니다.</div>
    );
  }

  return (
    <div className="space-y-4 px-4 py-4">
      {classes.map((c: any) => {
        // 폴더별 그룹핑 (폴더 정렬 순서 기준, 미지정은 맨 뒤)
        const groupMap = new Map<
          string,
          { name: string | null; sort: number; required: boolean | null; videos: any[] }
        >();
        for (const v of c.videos) {
          const key = v.folderId ?? NONE_KEY;
          const g = groupMap.get(key) ?? {
            name: v.folderName ?? null,
            sort: v.folderSort ?? 9999,
            required: v.folderIsRequired ?? null,
            videos: [],
          };
          g.videos.push(v);
          groupMap.set(key, g);
        }
        const groups = [...groupMap.entries()].sort((a, b) => {
          if (a[0] === NONE_KEY) return 1;
          if (b[0] === NONE_KEY) return -1;
          return a[1].sort - b[1].sort;
        });

        const renderVideoRow = (v: any) => (
          <tr key={v.videoId} className="border-t">
            <td className="max-w-[220px] truncate px-3 py-2">{v.title || "-"}</td>
            <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
              {v.weekLabel || "-"}
            </td>
            <td className="whitespace-nowrap px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-primary"
                    style={{ width: `${v.isCompleted ? 100 : Math.min(99, Math.ceil(v.watchedRatio * 100))}%` }}
                  />
                </span>
                <span className="tabular-nums">
                  {v.isCompleted ? 100 : Math.min(99, Math.ceil(v.watchedRatio * 1000) / 10)}%
                </span>
              </div>
            </td>
            <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
              {fmtDuration(v.watchedSeconds)}
            </td>
            <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
              {v.seekAttempts}회
            </td>
            <td className="whitespace-nowrap px-3 py-2">
              {v.isCompleted ? (
                <span className="inline-flex items-center gap-1 text-primary">
                  <CheckCircle2 className="h-3.5 w-3.5" /> 완료
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <Circle className="h-3.5 w-3.5" /> 미완료
                </span>
              )}
            </td>
            <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
              {v.updatedAt
                ? new Date(v.updatedAt).toLocaleDateString("ko-KR")
                : "-"}
            </td>
          </tr>
        );

        const renderFolderTable = (videos: any[]) => (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-xs">
              <thead className="bg-muted/40 text-left text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">영상</th>
                  <th className="px-3 py-2">주차</th>
                  <th className="px-3 py-2">시청률</th>
                  <th className="px-3 py-2">시청 시간</th>
                  <th className="px-3 py-2">건너뛰기 시도</th>
                  <th className="px-3 py-2">완료</th>
                  <th className="px-3 py-2">최근 활동</th>
                </tr>
              </thead>
              <tbody>
                {[...videos]
                  .sort((a: any, b: any) =>
                    (a.createdAt ?? "").localeCompare(b.createdAt ?? "")
                  )
                  .map(renderVideoRow)}
              </tbody>
            </table>
          </div>
        );

        return (
          <div key={c.classId} className="rounded-lg border border-border/60 bg-background">
            <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
              <span className="font-medium">{c.className}</span>
              {c.branch && (
                <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
                  {c.branch}
                </span>
              )}
              <span className="ml-auto text-xs text-muted-foreground">
                완료 {c.completed}/{c.videoTotal} · 평균 시청률{" "}
                {Math.min(100, Math.ceil(c.avgRatio * 1000) / 10)}%
              </span>
            </div>
            {c.videos.length === 0 ? (
              <p className="px-3 py-3 text-xs text-muted-foreground">등록된 영상이 없습니다.</p>
            ) : (
              <Accordion
                type="multiple"
                defaultValue={groups.map(([key]) => `f-${key}`)}
                className="flex flex-col gap-2 p-2"
              >
                {groups.map(([key, g]) => (
                  <AccordionItem
                    key={key}
                    value={`f-${key}`}
                    className="rounded-lg border bg-card px-3"
                  >
                    <AccordionTrigger className="hover:no-underline">
                      <span className="flex items-center gap-2">
                        <Folder className="h-4 w-4 text-muted-foreground" />
                        <span className="font-semibold">
                          {g.name || "폴더 미지정"}
                        </span>
                        {g.required === false && (
                          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground whitespace-nowrap">
                            선택 시청
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">({g.videos.length})</span>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent>{renderFolderTable(g.videos)}</AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            )}
          </div>
        );
      })}
    </div>
  );
}
