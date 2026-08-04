import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  getExternalAssignmentStatus,
  pushClassAssignmentToExternal,
} from "@/lib/external-assignment.functions";

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
  const pushAssignment = useServerFn(pushClassAssignmentToExternal);

  const [assignmentType, setAssignmentType] = useState(`${className} 영상 과제`);
  const [periodStart, setPeriodStart] = useState(today());
  const [periodEnd, setPeriodEnd] = useState(today(6));
  const [submitting, setSubmitting] = useState(false);

  const statusQuery = useQuery({
    queryKey: ["external-assignment-status", classId],
    queryFn: () => fetchStatus({ data: { classId } }),
    staleTime: 30_000,
  });

  const configured = statusQuery.data?.configured ?? false;
  const links = statusQuery.data?.links ?? [];

  const onSubmit = async () => {
    if (!assignmentType.trim()) {
      toast.error("과제명을 입력해 주세요.");
      return;
    }
    if (periodEnd < periodStart) {
      toast.error("종료일이 시작일보다 앞설 수 없습니다.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await pushAssignment({
        data: {
          classId,
          assignmentType: assignmentType.trim(),
          periodStart,
          periodEnd,
        },
      });
      toast.success(
        `과제를 내보냈습니다. 대상 학생 ${res.studentCount}명${res.skipped > 0 ? ` (식별 불가 ${res.skipped}명 제외)` : ""}`,
      );
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
          <CardTitle className="text-base">외부 과제 점검으로 내보내기</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!configured && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              외부 연동 설정이 아직 없습니다. 외부 프로젝트에서 발급한 API 주소와 키를 등록하면 바로 사용할 수 있습니다.
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-3">
              <Label htmlFor="eap-name">과제명</Label>
              <Input
                id="eap-name"
                value={assignmentType}
                onChange={(e) => setAssignmentType(e.target.value)}
                placeholder="예: 8월 1주 영상 과제"
              />
            </div>
            <div>
              <Label htmlFor="eap-start">시작일</Label>
              <Input
                id="eap-start"
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="eap-end">종료일</Label>
              <Input id="eap-end" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button onClick={onSubmit} disabled={submitting || !configured} className="w-full">
                {submitting ? "전송 중..." : "과제 내보내기"}
              </Button>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            이 수강반에 배정된 학생 전체가 대상이 됩니다. 학생이 영상 시청을 완료하면 외부 과제 점검의 해당 항목이
            자동으로 완료 처리됩니다. 주차 구분은 외부 시스템이 전송된 날짜를 기준으로 계산합니다.
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
                  <div className="mt-1 text-xs text-muted-foreground">
                    기간 {l.period_start} ~ {l.period_end} · 키 {l.external_id}
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
