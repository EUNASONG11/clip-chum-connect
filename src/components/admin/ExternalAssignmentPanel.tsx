import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  getExternalAssignmentStatus,
  listClassVideosForAssignment,
  pushVideoAssignmentsToExternal,
} from "@/lib/external-assignment.functions";

const STATUS_LABEL: Record<string, string> = {
  initial: "미완료",
  review_completed: "완료 처리",
  sent: "전송 완료",
  failed: "전송 실패",
  pending: "전송 대기",
};

function today(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export function ExternalAssignmentPanel({
  classId,
  className,
}: {
  classId: string;
  className: string;
}) {
  const fetchStatus = useServerFn(getExternalAssignmentStatus);
  const fetchVideos = useServerFn(listClassVideosForAssignment);
  const pushVideos = useServerFn(pushVideoAssignmentsToExternal);

  const [titlePrefix, setTitlePrefix] = useState(className);
  const [periodStart, setPeriodStart] = useState(today());
  const [periodEnd, setPeriodEnd] = useState(today(6));
  const [selected, setSelected] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const statusQuery = useQuery({
    queryKey: ["external-assignment-status", classId],
    queryFn: () => fetchStatus({ data: { classId } }),
    staleTime: 30_000,
  });

  const videosQuery = useQuery({
    queryKey: ["external-assignment-videos", classId],
    queryFn: () => fetchVideos({ data: { classId } }),
    staleTime: 30_000,
  });

  const configured = statusQuery.data?.configured ?? false;
  const links = statusQuery.data?.links ?? [];
  const videos = videosQuery.data ?? [];

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));

  const onSubmit = async () => {
    if (selected.length === 0) {
      toast.error("내보낼 영상을 선택해 주세요.");
      return;
    }
    if (periodEnd < periodStart) {
      toast.error("종료일이 시작일보다 앞설 수 없습니다.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await pushVideoAssignmentsToExternal
        ? await pushVideos({
            data: {
              classId,
              videoIds: selected,
              periodStart,
              periodEnd,
              titlePrefix: titlePrefix.trim() || className,
            },
          })
        : null;
      const failed = (res?.results ?? []).filter((r: any) => !r.ok);
      if (failed.length > 0) {
        toast.error(`${failed.length}개 영상 전송 실패: ${failed[0]?.error ?? ""}`);
      } else {
        toast.success(
          `영상 ${selected.length}개 과제를 내보냈습니다. 대상 학생 ${res?.studentCount ?? 0}명${
            (res?.skipped ?? 0) > 0 ? ` (식별 불가 ${res?.skipped}명 제외)` : ""
          }`,
        );
      }
      setSelected([]);
      await statusQuery.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "과제 내보내기에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">외부 과제 점검으로 내보내기 (영상별)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!configured && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              외부 연동 설정이 아직 없습니다. 외부 프로젝트에서 발급한 API 주소와 키를 등록하면 바로 사용할 수 있습니다.
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div className="min-w-0 md:col-span-2 lg:col-span-3">
              <Label htmlFor="eap-prefix">과제명 앞머리</Label>
              <Input
                id="eap-prefix"
                className="w-full min-w-0"
                value={titlePrefix}
                onChange={(e) => setTitlePrefix(e.target.value)}
                placeholder="예: 19기"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                외부 과제명은 &quot;앞머리 - 영상 제목&quot; 형태로 영상별로 각각 생성됩니다.
              </p>
            </div>
            <div className="min-w-0">
              <Label htmlFor="eap-start">시작일</Label>
              <Input
                id="eap-start"
                type="date"
                className="w-full min-w-0"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
              />
            </div>
            <div className="min-w-0">
              <Label htmlFor="eap-end">종료일</Label>
              <Input
                id="eap-end"
                type="date"
                className="w-full min-w-0"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
              />
            </div>
            <div className="flex min-w-0 items-end md:col-span-2 lg:col-span-1">
              <Button onClick={onSubmit} disabled={submitting || !configured} className="w-full">
                {submitting ? "전송 중..." : `선택 영상 내보내기 (${selected.length})`}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>영상 선택</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSelected(videos.map((v: any) => v.id))}
                  disabled={videos.length === 0}
                >
                  전체 선택
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelected([])}
                  disabled={selected.length === 0}
                >
                  선택 해제
                </Button>
              </div>
            </div>
            {videosQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">영상 목록을 불러오는 중...</p>
            ) : videos.length === 0 ? (
              <p className="text-sm text-muted-foreground">이 수강반에 영상이 없습니다.</p>
            ) : (
              <ul className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
                {videos.map((v: any) => (
                  <li key={v.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60">
                      <Checkbox
                        checked={selected.includes(v.id)}
                        onCheckedChange={() => toggle(v.id)}
                      />
                      <span className="min-w-0 break-words">{v.title}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            선택한 영상마다 외부 과제가 각각 생성되며, 이 수강반에 배정된 학생 전체가 대상이 됩니다. 학생이 해당 영상
            시청을 완료하면 그 영상의 과제 항목만 자동으로 완료 처리됩니다.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">내보낸 과제 이력</CardTitle>
        </CardHeader>
        <CardContent>
          {statusQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">불러오는 중...</p>
          ) : links.length === 0 ? (
            <p className="text-sm text-muted-foreground">아직 내보낸 과제가 없습니다.</p>
          ) : (
            <ul className="space-y-2">
              {links.map((l: any) => (
                <li key={l.id} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{l.assignment_type}</span>
                    {l.last_error ? (
                      <Badge variant="destructive">전송 실패</Badge>
                    ) : (
                      <Badge variant="secondary">전송 완료</Badge>
                    )}
                    <Badge variant="outline">
                      완료 {l.completed_count ?? 0} / 대상 {l.target_count ?? l.student_count}명
                    </Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {Object.entries((l.status_counts ?? {}) as Record<string, number>).map(
                      ([status, count]) => (
                        <span
                          key={status}
                          className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
                        >
                          {STATUS_LABEL[status] ?? status} {count}명
                        </span>
                      ),
                    )}
                  </div>
                  {(l.completed_students ?? []).length > 0 && (
                    <div className="mt-2 rounded-md bg-muted/50 p-2">
                      <div className="mb-1 text-xs font-medium">완료 처리된 학생</div>
                      <div className="flex flex-wrap gap-1">
                        {(l.completed_students as any[]).map((p) => (
                          <span
                            key={p.user_id}
                            className="rounded-full border bg-background px-2 py-0.5 text-xs"
                          >
                            {p.name}
                            <span className="ml-1 text-muted-foreground">
                              {STATUS_LABEL[p.status] ?? p.status}
                              {l.last_synced_at || l.created_at
                                ? ` · ${String(l.last_synced_at ?? l.created_at).slice(0, 10)}`
                                : ""}
                            </span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="mt-1 text-xs text-muted-foreground">
                    기간 {l.period_start} ~ {l.period_end}
                  </div>
                  {l.last_error && (
                    <div className="mt-1 break-all text-xs text-destructive">{l.last_error}</div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
