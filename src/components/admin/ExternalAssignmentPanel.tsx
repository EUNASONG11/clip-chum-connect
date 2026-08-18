import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { formatWeekLabel, weekRange } from "@/lib/week";
import {
  getExternalAssignmentStatus,
  listClassWeeksForAssignment,
  listResyncTargets,
  pushWeekAssignmentsToExternal,
  resyncCompletionsToExternal,
} from "@/lib/external-assignment.functions";

const STATUS_LABEL: Record<string, string> = {
  initial: "미완료",
  review_completed: "완료 처리",
  sent: "전송 완료",
  failed: "전송 실패",
  pending: "전송 대기",
  not_sent: "미전송",
};


export function ExternalAssignmentPanel({
  classId,
  className,
}: {
  classId: string;
  className: string;
}) {
  const fetchStatus = useServerFn(getExternalAssignmentStatus);
  const fetchWeeks = useServerFn(listClassWeeksForAssignment);
  const pushWeeks = useServerFn(pushWeekAssignmentsToExternal);
  const resyncCompletions = useServerFn(resyncCompletionsToExternal);
  const fetchTargets = useServerFn(listResyncTargets);

  const [titlePrefix, setTitlePrefix] = useState(className);
  const [selected, setSelected] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [resyncing, setResyncing] = useState(false);
  const [resyncOpen, setResyncOpen] = useState(false);
  const [resyncUsers, setResyncUsers] = useState<string[]>([]);

  const statusQuery = useQuery({
    queryKey: ["external-assignment-status", classId],
    queryFn: () => fetchStatus({ data: { classId } }),
    staleTime: 30_000,
  });

  const weeksQuery = useQuery({
    queryKey: ["external-assignment-weeks", classId],
    queryFn: () => fetchWeeks({ data: { classId } }),
    staleTime: 30_000,
  });

  const targetsQuery = useQuery({
    queryKey: ["external-assignment-resync-targets", classId, selected[0]],
    queryFn: () => {
      const weekLabel = selected[0];
      if (!weekLabel) throw new Error("재통보할 주차를 선택해 주세요.");
      return fetchTargets({ data: { classId, weekLabel } });
    },
    enabled: resyncOpen && selected.length === 1,
    staleTime: 10_000,
  });

  const targets = (targetsQuery.data ?? []) as any[];

  const configured = statusQuery.data?.configured ?? false;
  const links = statusQuery.data?.links ?? [];
  const weeks = (weeksQuery.data ?? []) as any[];
  const labeledWeeks = weeks.filter((w) => !!w.week_label);
  const unlabeled = weeks.find((w) => !w.week_label);

  const toggle = (label: string) =>
    setSelected((prev) => (prev.includes(label) ? prev.filter((v) => v !== label) : [...prev, label]));

  const toggleUser = (id: string) =>
    setResyncUsers((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));

  const assignmentName = (label: string) =>
    `${titlePrefix.trim() || className} ${formatWeekLabel(label)} 영상 과제`;

  const onResync = async () => {
    const weekLabel = selected[0];
    if (selected.length !== 1 || !weekLabel) {
      toast.error("재통보할 주차를 1개만 선택해 주세요.");
      return;
    }
    if (resyncUsers.length === 0) {
      toast.error("재통보할 학생을 선택해 주세요.");
      return;
    }
    setResyncing(true);
    try {
      const res = await resyncCompletions({
        data: { classId, weekLabel, userIds: resyncUsers },
      });
      toast.success(
        `학생 ${resyncUsers.length}명 · 완료 기록 ${res.total}건 확인, ${res.sent}건 통보 처리했습니다.`,
      );
      setResyncOpen(false);
      setResyncUsers([]);
      statusQuery.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "재통보에 실패했습니다.");
    } finally {
      setResyncing(false);
    }
  };


  const onSubmit = async () => {
    if (selected.length === 0) {
      toast.error("내보낼 주차를 선택해 주세요.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await pushWeeks({
        data: {
          classId,
          weeks: selected.map((label) => {
            const range = weekRange(label);
            return {
              weekLabel: label,
              assignmentType: assignmentName(label),
              periodStart: range.start,
              periodEnd: range.end,
            };
          }),
        },
      });
      const failed = (res?.results ?? []).filter((r: any) => !r.ok);
      if (failed.length > 0) {
        toast.error(`${failed.length}개 주차 전송 실패: ${failed[0]?.error ?? ""}`);
      } else {
        toast.success(
          `주차 ${selected.length}건 과제를 내보냈습니다. 대상 학생 ${res?.studentCount ?? 0}명${
            (res?.skipped ?? 0) > 0 ? ` (식별 불가 ${res?.skipped}명 제외)` : ""
          }`,
        );
      }
      setSelected([]);
      await Promise.all([statusQuery.refetch(), weeksQuery.refetch()]);
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
          <CardTitle className="text-base">외부 과제 점검으로 내보내기 (주차별)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!configured && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              외부 연동 설정이 아직 없습니다. 외부 프로젝트에서 발급한 API 주소와 키를 등록하면 바로 사용할 수 있습니다.
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="min-w-0 md:col-span-2">
              <Label htmlFor="eap-prefix">과제명 앞머리</Label>
              <Input
                id="eap-prefix"
                className="w-full min-w-0"
                value={titlePrefix}
                onChange={(e) => setTitlePrefix(e.target.value)}
                placeholder="예: 19기"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                외부 과제명은 &quot;앞머리 8월 1주차 영상 과제&quot; 형태로 주차별 1건씩 생성됩니다. 과제 기간은 해당
                주차의 시작일~종료일로 자동 설정됩니다.
              </p>
            </div>
            <div className="flex min-w-0 items-end gap-2">
              <Button onClick={onSubmit} disabled={submitting || !configured} className="flex-1">
                {submitting ? "전송 중..." : `선택 주차 내보내기 (${selected.length})`}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (selected.length !== 1) {
                    toast.error("완료 재통보할 주차를 1개만 선택해 주세요.");
                    return;
                  }
                  setResyncUsers([]);
                  setResyncOpen(true);
                }}
                disabled={!configured || selected.length !== 1}
              >
                완료 재통보
              </Button>

            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>주차 선택</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSelected(labeledWeeks.map((w) => w.week_label as string))}
                  disabled={labeledWeeks.length === 0}
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
            {weeksQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">주차 목록을 불러오는 중...</p>
            ) : labeledWeeks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                주차가 지정된 영상이 없습니다. 영상 설정에서 주차를 먼저 지정해 주세요.
              </p>
            ) : (
              <ul className="max-h-72 space-y-1 overflow-y-auto rounded-md border p-2">
                {labeledWeeks.map((w) => {
                  const label = w.week_label as string;
                  const range = weekRange(label);
                  return (
                    <li key={label}>
                      <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60">
                        <Checkbox
                          className="mt-0.5"
                          checked={selected.includes(label)}
                          onCheckedChange={() => toggle(label)}
                        />
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{formatWeekLabel(label)}</span>
                            <Badge variant="outline">영상 {w.videos.length}개</Badge>
                            {w.link ? <Badge variant="secondary">내보냄</Badge> : null}
                            <span className="text-xs text-muted-foreground">
                              {range.start} ~ {range.end}
                            </span>
                          </span>
                          <span className="mt-0.5 block break-words text-xs text-muted-foreground">
                            {w.videos.map((v: any) => v.title).join(", ")}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            {unlabeled && (
              <p className="text-xs text-muted-foreground">
                주차 미지정 영상 {unlabeled.videos.length}개는 연동 대상에서 제외됩니다.
              </p>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            주차별로 외부 과제 1건이 생성되며, 학생이 그 주차의 모든 영상 시청을 완료한 시점에 해당 과제가 자동으로
            완료 처리됩니다.
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
                    {l.week_label ? (
                      <Badge variant="outline">주차: {formatWeekLabel(l.week_label)}</Badge>
                    ) : l.video_title ? (
                      <Badge variant="outline">영상: {l.video_title}</Badge>
                    ) : (
                      <Badge variant="outline">수강반 단위</Badge>
                    )}
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

      <Dialog open={resyncOpen} onOpenChange={setResyncOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>완료 재통보 대상 선택</DialogTitle>
            <DialogDescription>
              {selected[0] ? `${formatWeekLabel(selected[0])} ` : ""}영상을 모두 완료한 학생 중 재통보할 대상을 선택해 주세요.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{resyncUsers.length}명 선택</span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setResyncUsers(targets.map((t) => t.user_id as string))}
                disabled={targets.length === 0}
              >
                전체 선택
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setResyncUsers(
                    targets
                      .filter((t) => t.status === "failed" || t.status === "not_sent" || t.status === "pending")
                      .map((t) => t.user_id as string),
                  )
                }
                disabled={targets.length === 0}
              >
                실패·미전송만
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setResyncUsers([])}
                disabled={resyncUsers.length === 0}
              >
                해제
              </Button>
            </div>
          </div>

          {targetsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">학생 목록을 불러오는 중...</p>
          ) : targets.length === 0 ? (
            <p className="text-sm text-muted-foreground">완료 기록이 있는 학생이 없습니다.</p>
          ) : (
            <ul className="max-h-80 space-y-1 overflow-y-auto rounded-md border p-2">
              {targets.map((t) => (
                <li key={t.user_id}>
                  <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60">
                    <Checkbox
                      className="mt-0.5"
                      checked={resyncUsers.includes(t.user_id)}
                      onCheckedChange={() => toggleUser(t.user_id)}
                    />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{t.name}</span>
                        <Badge
                          variant={
                            t.status === "failed"
                              ? "destructive"
                              : t.status === "review_completed" || t.status === "sent"
                                ? "secondary"
                                : "outline"
                          }
                        >
                          {STATUS_LABEL[t.status] ?? t.status}
                        </Badge>
                        <Badge variant="outline">완료 영상 {t.completed_videos}개</Badge>
                        {!t.identified && <Badge variant="destructive">식별 불가</Badge>}
                      </span>
                      {t.error_message && (
                        <span className="mt-0.5 block break-all text-xs text-destructive">
                          {String(t.error_message).slice(0, 160)}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setResyncOpen(false)}>
              취소
            </Button>
            <Button type="button" onClick={onResync} disabled={resyncing || resyncUsers.length === 0}>
              {resyncing ? "재통보 중..." : `선택 학생 재통보 (${resyncUsers.length})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>

  );
}
