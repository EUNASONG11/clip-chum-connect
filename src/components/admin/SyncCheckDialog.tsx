import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Stethoscope } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatWeekLabel } from "@/lib/week";
import { listSyncCheckTargets, syncOneWeekAssignment } from "@/lib/external-assignment.functions";

type Row = {
  classId: string;
  weekLabel: string;
  className: string;
  studentCount: number;
  reasons: ("missing" | "failed" | "resync" | "timeout")[];
  lastError: string | null;
};
type Result =
  | { state: "running" }
  | { state: "ok" | "fail" | "skip"; sent: number; failed: number; remaining: number; ms: number; push: string; error?: string | null };

const REASON: Record<string, string> = {
  missing: "미생성",
  failed: "실패",
  resync: "재통보 필요",
  timeout: "응답 지연",
};
const PUSH: Record<string, string> = {
  sent: "과제 전송",
  skipped: "변경 없음",
  timeout: "응답 지연",
  failed: "과제 실패",
  no_enrolled: "건너뜀: 배정 학생 없음",
  no_external_ids: "건너뜀: 외부 ID 연결된 학생 없음(명부 동기화 필요)",
  no_branch_students: "건너뜀: 해당 교육원 학생 없음",
  class_deleted: "건너뜀: 삭제된 수강반",
  link_deleted: "건너뜀: 관리자가 삭제한 주차 과제",
  invalid: "건너뜀: 수강반/주차 정보 없음",
};
const isSkip = (p: string) => !["sent", "skipped", "timeout", "failed"].includes(p);

export function SyncCheckDialog() {
  const fetchTargets = useServerFn(listSyncCheckTargets);
  const syncOne = useServerFn(syncOneWeekAssignment);
  const [open, setOpen] = useState(false);
  const [includeTimeout, setIncludeTimeout] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const key = (r: Row) => `${r.classId}|${r.weekLabel}`;

  async function load(inc = includeTimeout) {
    setLoading(true);
    try {
      setRows((await fetchTargets({ data: { includeTimeout: inc } })) as Row[]);
      setResults({});
      setProgress(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function runOne(r: Row): Promise<boolean> {
    const k = key(r);
    setResults((p) => ({ ...p, [k]: { state: "running" } }));
    let sent = 0;
    let failed = 0;
    let ms = 0;
    let push = "";
    let remaining = 0;
    let error: string | null = null;
    try {
      // 남은 인원이 있으면 같은 건을 이어서 호출 (최대 10회)
      for (let i = 0; i < 10; i++) {
        const res = await syncOne({
          data: { classId: r.classId, weekLabel: r.weekLabel, force: i === 0 && r.reasons.includes("timeout") },
        });
        sent += res.sent;
        failed += res.failed;
        ms += res.ms;
        if (i === 0) push = res.push;
        remaining = res.remaining;
        error = res.error ?? null;
        if (res.push === "failed" || isSkip(res.push) || remaining === 0 || res.sent === 0) break;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      push = "failed";
    }
    const skipped = isSkip(push);
    const ok = push !== "failed" && !skipped && failed === 0 && remaining === 0;
    setResults((p) => ({ ...p, [k]: { state: skipped ? "skip" : ok ? "ok" : "fail", sent, failed, remaining, ms, push, error } }));
    return ok;
  }

  async function runAll(only?: Row[]) {
    const list = only ?? rows ?? [];
    if (list.length === 0) return;
    setRunning(true);
    setProgress({ done: 0, total: list.length });
    let okCount = 0;
    for (let i = 0; i < list.length; i++) {
      if (await runOne(list[i]!)) okCount++;
      setProgress({ done: i + 1, total: list.length });
    }
    setRunning(false);
    toast.success(`연동 점검 완료: ${okCount}/${list.length}건 성공`);
  }

  const failedRows = (rows ?? []).filter((r) => results[key(r)]?.state === "fail");

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setOpen(true);
          void load();
        }}
      >
        <Stethoscope className="mr-1 h-4 w-4" /> 연동 점검
      </Button>
      <Dialog open={open} onOpenChange={(o) => !running && setOpen(o)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>외부 과제 연동 점검</DialogTitle>
            <DialogDescription>
              주차 영상이 있는데 외부 과제가 없거나, 실패했거나, 완료 재통보가 남은 주차입니다. 1건씩 순서대로 다시 연결합니다.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="inc-timeout"
                checked={includeTimeout}
                disabled={running}
                onCheckedChange={(v) => {
                  setIncludeTimeout(!!v);
                  void load(!!v);
                }}
              />
              <Label htmlFor="inc-timeout" className="text-sm">응답 지연(확인 필요) 건도 포함</Label>
            </div>
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="outline" disabled={running || loading} onClick={() => load()}>
                새로고침
              </Button>
              {failedRows.length > 0 && (
                <Button size="sm" variant="outline" disabled={running} onClick={() => runAll(failedRows)}>
                  실패 건만 다시 ({failedRows.length})
                </Button>
              )}
              <Button size="sm" disabled={running || loading || !rows?.length} onClick={() => runAll()}>
                전체 다시 연결
              </Button>
            </div>
          </div>

          {progress && (
            <p className="text-sm text-muted-foreground">
              진행 {progress.done}/{progress.total}
            </p>
          )}

          {loading ? (
            <p className="text-sm text-muted-foreground">불러오는 중...</p>
          ) : !rows || rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">점검이 필요한 주차가 없습니다.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="p-2">수강반</th>
                    <th className="p-2">주차</th>
                    <th className="p-2">학생</th>
                    <th className="p-2">사유</th>
                    <th className="p-2">결과</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const res = results[key(r)];
                    return (
                      <tr key={key(r)} className="border-t align-top">
                        <td className="p-2">{r.className}</td>
                        <td className="p-2 whitespace-nowrap">{formatWeekLabel(r.weekLabel)}</td>
                        <td className="p-2">{r.studentCount}명</td>
                        <td className="p-2">
                          <div className="flex flex-wrap gap-1">
                            {r.reasons.map((x) => (
                              <Badge
                                key={x}
                                variant={x === "failed" ? "destructive" : "outline"}
                                className={x === "timeout" ? "bg-warning text-warning-foreground" : undefined}
                              >
                                {REASON[x]}
                              </Badge>
                            ))}
                          </div>
                          {r.lastError && (
                            <div className="mt-1 max-w-xs break-all text-xs text-destructive">{r.lastError.slice(0, 160)}</div>
                          )}
                        </td>
                        <td className="p-2 text-xs">
                          {!res ? (
                            <span className="text-muted-foreground">-</span>
                          ) : res.state === "running" ? (
                            <span className="text-muted-foreground">처리 중...</span>
                          ) : (
                            <div className="space-y-0.5">
                              <Badge variant={res.state === "ok" ? "secondary" : res.state === "skip" ? "outline" : "destructive"}>
                                {res.state === "ok" ? "성공" : res.state === "skip" ? "건너뜀" : "실패"}
                              </Badge>
                              <div>
                                {PUSH[res.push] ?? res.push} · 통보 {res.sent}명
                                {res.failed > 0 ? ` · 실패 ${res.failed}명` : ""}
                                {res.remaining > 0 ? ` · 남음 ${res.remaining}명` : ""} · {(res.ms / 1000).toFixed(1)}초
                              </div>
                              {res.error && <div className="break-all text-destructive">{res.error.slice(0, 160)}</div>}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
