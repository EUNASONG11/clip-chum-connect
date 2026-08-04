import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { GraduationCap, Save, KeyRound } from "lucide-react";
import {
  listInstructorRoster,
  updateInstructorEmail,
  updateInstructorCohort,
  bulkCreateInstructorAccounts,
} from "@/lib/vimeo.functions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { COHORT_OPTIONS } from "@/lib/cohort";
import { AdminOnly } from "@/components/AdminRole";
import { BranchBadge } from "@/components/BranchBadge";
import { ClearableSearchInput } from "@/components/admin/ClearableSearchInput";
import { CohortMultiSelect } from "@/components/admin/CohortMultiSelect";

export const Route = createFileRoute("/admin/instructors")({
  head: () => ({ meta: [{ title: "강사 명부 — 관리자" }] }),
  component: InstructorsPage,
});

type Row = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  branch: string | null;
  cohort: string | null;
  auth_user_id: string | null;
  must_change_password: boolean | null;
};

function InstructorsPage() {
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["admin", "instructors", "roster"],
    queryFn: async () => (await listInstructorRoster()) as Row[],
    staleTime: 30_000,
  });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [cohortFilter, setCohortFilter] = useState<string[]>([]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const byCohort =
      cohortFilter === "__all__"
        ? rows
        : cohortFilter === "__none__"
          ? rows.filter((r) => !r.cohort)
          : rows.filter((r) => r.cohort === cohortFilter);
    if (!needle) return byCohort;
    return byCohort.filter(
      (r) =>
        r.name.toLowerCase().includes(needle) ||
        (r.email ?? "").toLowerCase().includes(needle) ||
        (r.phone ?? "").includes(needle),
    );
  }, [rows, q, cohortFilter]);

  const withEmail = rows.filter((r) => (r.email ?? "").trim()).length;
  const withAccount = rows.filter((r) => r.auth_user_id).length;

  const save = async (row: Row) => {
    const val = (drafts[row.id] ?? row.email ?? "").trim();
    if (!val) return toast.error("이메일을 입력하세요.");
    setSavingId(row.id);
    try {
      await updateInstructorEmail({ data: { id: row.id, email: val } });
      toast.success("저장되었습니다.");
      qc.invalidateQueries({ queryKey: ["admin", "instructors", "roster"] });
      setDrafts((d) => {
        const n = { ...d };
        delete n[row.id];
        return n;
      });
    } catch (e: any) {
      toast.error(e.message ?? "저장 실패");
    } finally {
      setSavingId(null);
    }
  };

  const bulkCreate = async () => {
    if (!confirm("이메일이 입력된 강사들에게 초기 비밀번호 12345678로 계정을 일괄 생성하시겠습니까?")) return;
    setBusy(true);
    try {
      const res: any = await bulkCreateInstructorAccounts();
      toast.success(
        `완료 (신규 ${res.created}, 연결 ${res.linked}, 실패 ${res.failed} / 총 ${res.total})`,
      );
      if (res.errors?.length) console.warn("계정 생성 오류:", res.errors);
      qc.invalidateQueries({ queryKey: ["admin", "instructors", "roster"] });
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
    } catch (e: any) {
      toast.error(e.message ?? "생성 실패");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminOnly>
      <div className="space-y-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="flex items-center gap-2">
              <GraduationCap className="h-5 w-5" />
              강사 명부 ({rows.length}) · 이메일 입력 {withEmail} · 계정 생성됨 {withAccount}
            </CardTitle>
            {/*
            <Button size="sm" onClick={bulkCreate} disabled={busy} className="gap-1">
              <KeyRound className="h-4 w-4" />
              {busy ? "처리 중..." : "이메일 입력된 강사 계정 일괄 생성"}
            </Button>
            */}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <ClearableSearchInput
                value={q}
                onChange={setQ}
                placeholder="이름·이메일·전화번호 검색"
                className="max-w-sm"
                inputClassName="pl-8"
              />
              <Select
                value={cohortFilter}
                onValueChange={setCohortFilter}
              >
                <SelectTrigger className="h-9 w-full sm:w-44">
                  <SelectValue placeholder="기수 전체" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">기수 전체</SelectItem>
                  <SelectItem value="__none__">미지정</SelectItem>
                  {COHORT_OPTIONS.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isLoading ? (
              <p className="text-sm text-muted-foreground">불러오는 중...</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-2">이름</th>
                      <th className="py-2 pr-2">전화번호</th>
                      <th className="py-2 pr-2">지점</th>
                      <th className="py-2 pr-2">기수</th>
                      <th className="py-2 pr-2">이메일 (로그인 ID)</th>
                      <th className="py-2 pr-2">계정 상태</th>
                      <th className="py-2 pr-2 text-right">작업</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => {
                      const draft = drafts[r.id];
                      const value = draft !== undefined ? draft : r.email ?? "";
                      const dirty = draft !== undefined && draft !== (r.email ?? "");
                      return (
                        <tr key={r.id} className="border-t">
                          <td className="py-2 pr-2 font-medium">{r.name}</td>
                          <td className="py-2 pr-2 text-muted-foreground">{r.phone || "-"}</td>
                          <td className="py-2 pr-2 text-muted-foreground">
                            {r.branch ? <BranchBadge branch={r.branch} /> : "-"}
                          </td>
                          <td className="py-2 pr-2">
                            <Select
                              value={r.cohort ?? "__none__"}
                              onValueChange={async (v) => {
                                try {
                                  await updateInstructorCohort({
                                    data: { instructorId: r.id, cohort: v === "__none__" ? null : v },
                                  });
                                  toast.success("기수가 저장되었습니다.");
                                  qc.invalidateQueries({ queryKey: ["admin", "instructors", "roster"] });
                                  qc.invalidateQueries({ queryKey: ["admin", "users"] });
                                } catch (e: any) {
                                  toast.error(e.message ?? "기수 저장 실패");
                                }
                              }}
                            >
                              <SelectTrigger className="h-8 w-[110px]">
                                <SelectValue placeholder="미지정" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">미지정</SelectItem>
                                {COHORT_OPTIONS.map((c) => (
                                  <SelectItem key={c} value={c}>{c}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="py-2 pr-2">
                            <Input
                              type="email"
                              value={value}
                              onChange={(e) =>
                                setDrafts((d) => ({ ...d, [r.id]: e.target.value }))
                              }
                              placeholder="teacher@example.com"
                              className="h-8"
                            />
                          </td>
                          <td className="py-2 pr-2 text-xs">
                            {r.auth_user_id ? (
                              <span className="text-green-600">
                                계정 있음{r.must_change_password ? " · 비번 변경 필요" : ""}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">미생성</span>
                            )}
                          </td>
                          <td className="py-2 pr-2 text-right">
                            <Button
                              size="sm"
                              variant={dirty ? "default" : "outline"}
                              disabled={!dirty || savingId === r.id}
                              onClick={() => save(r)}
                              className="gap-1"
                            >
                              <Save className="h-3.5 w-3.5" />
                              {savingId === r.id ? "저장 중..." : "저장"}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-muted-foreground">
                          표시할 강사가 없습니다.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminOnly>
  );
}
