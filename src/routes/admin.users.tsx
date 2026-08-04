import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  UserMinus,
  Loader2,
  Users,
  ShieldCheck,
  GraduationCap,
  Clock,
  Check,
  X,
} from "lucide-react";
import {
  listUsers,
  revokeAdmin,
  approveUser,
  rejectUser,
  bulkApproveUsers,
  revertToPending,
  bulkCreateInstructorAccounts,
  updateInstructorCohort,
} from "@/lib/vimeo.functions";
import { COHORT_OPTIONS } from "@/lib/cohort";
import { backfillBranchesFromMaster } from "@/lib/branch-backfill.functions";
import { BranchBadge } from "@/components/BranchBadge";
import { AdminOnly } from "@/components/AdminRole";
import { ClearableSearchInput } from "@/components/admin/ClearableSearchInput";

import { Checkbox } from "@/components/ui/checkbox";

type UserRow = {
  id: string;
  email: string;
  nickname: string;
  phone: string;
  created_at: string;
  roles: string[];
  isAdmin: boolean;
  isStudent: boolean;
  isInstructor: boolean;
  isPending: boolean;
  class_count: number;
  branch: string | null;
  cohort: string | null;
};


const usersQueryOptions = queryOptions({
  queryKey: ["admin", "users"],
  queryFn: async () => (await listUsers()) as UserRow[],
  staleTime: 5 * 60_000,
  gcTime: 10 * 60_000,
});

type TabKey = "admin" | "instructor" | "student" | "pending";

export const Route = createFileRoute("/admin/users")({
  component: UsersPage,
});

function Badge({
  tone,
  children,
}: {
  tone: "admin" | "instructor" | "student" | "pending";
  children: React.ReactNode;
}) {
  const map = {
    admin: "bg-primary/10 text-primary border-primary/20",
    instructor: "bg-sky-100 text-sky-700 border-sky-200",
    student: "bg-accent/60 text-accent-foreground border-accent",
    pending: "bg-amber-100 text-amber-700 border-amber-200",
  } as const;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${map[tone]}`}
    >
      {children}
    </span>
  );
}

const PAGE_SIZE = 20;

function UsersPage() {
  const qc = useQueryClient();
  const { data: users = [], isFetching } = useQuery(usersQueryOptions);
  const [tab, setTab] = useState<TabKey>("student");
  const [search, setSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState<string>("__all__");
  const [cohortFilter, setCohortFilter] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [backfillBusy, setBackfillBusy] = useState(false);

  async function runBackfill() {
    if (backfillBusy) return;
    if (!confirm("마스터 프로젝트에서 교육원 정보를 가져와 학생 branch를 일괄 업데이트합니다. 진행할까요?")) return;
    setBackfillBusy(true);
    try {
      const res = await backfillBranchesFromMaster();
      if (res.ok) {
        toast.success(`백필 완료: 조회 ${res.totalFetched}건, 업데이트 ${res.totalUpdated}건`);
      } else {
        toast.error(`일부 오류 발생 (업데이트 ${res.totalUpdated}건): ${res.errors.slice(0, 2).join(" / ")}`);
      }
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
    } catch (e: any) {
      toast.error(e?.message ?? "백필 실패");
    } finally {
      setBackfillBusy(false);
    }
  }
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [pages, setPages] = useState<Record<TabKey, number>>({
    admin: 1,
    instructor: 1,
    student: 1,
    pending: 1,
  });

  const page = pages[tab];
  const setPage = (p: number) =>
    setPages((prev) => ({ ...prev, [tab]: Math.max(1, p) }));

  const buckets = useMemo(() => {
    const admin: UserRow[] = [];
    const instructor: UserRow[] = [];
    const student: UserRow[] = [];
    const pending: UserRow[] = [];
    for (const u of users) {
      if (u.isAdmin) admin.push(u);
      else if (u.isInstructor) instructor.push(u);
      else if (u.isStudent) student.push(u);
      else pending.push(u);
    }
    return { admin, instructor, student, pending };
  }, [users]);


  const branchOptions = useMemo(() => {
    const set = new Set<string>();
    users.forEach((u) => {
      const b = (u.branch ?? "").trim();
      if (b) set.add(b);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ko"));
  }, [users]);

  const cohortOptions = useMemo(() => {
    const set = new Set<string>();
    buckets.instructor.forEach((u) => {
      const c = (u.cohort ?? "").trim();
      if (c) set.add(c);
    });
    return Array.from(set).sort((a, b) => b.localeCompare(a, "ko"));
  }, [buckets.instructor]);

  const filtered = useMemo(() => {
    const rows = buckets[tab];
    const terms = search
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 0);
    const byBranch =
      branchFilter === "__all__"
        ? rows
        : rows.filter((u) => (u.branch ?? "") === branchFilter);
    const byCohort =
      tab !== "instructor" || cohortFilter === "__all__"
        ? byBranch
        : cohortFilter === "__none__"
          ? byBranch.filter((u) => !u.cohort)
          : byBranch.filter((u) => u.cohort === cohortFilter);
    if (terms.length === 0) return byCohort;
    return byCohort.filter((u) => {
      const haystack = `${u.email.toLowerCase()} ${u.nickname.toLowerCase()} ${(u.phone ?? "").toLowerCase()}`;
      return terms.some((term) => haystack.includes(term));
    });
  }, [buckets, tab, search, branchFilter, cohortFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const paged = filtered.slice(pageStart, pageStart + PAGE_SIZE);


  const refetch = () => qc.refetchQueries({ queryKey: ["admin", "users"] });

  const roleName = (r: "student" | "admin" | "instructor") =>
    r === "admin" ? "관리자" : r === "instructor" ? "강사" : "학생";

  const doApprove = async (u: UserRow, role: "student" | "admin" | "instructor") => {
    setBusyId(u.id);
    try {
      await approveUser({ data: { userId: u.id, role } });
      toast.success(`${roleName(role)}(으)로 승인되었습니다.`);
      refetch();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  };


  const doReject = async (u: UserRow) => {
    if (!confirm(`${u.email} 계정을 삭제(거절)하시겠습니까?`)) return;
    setBusyId(u.id);
    try {
      await rejectUser({ data: { userId: u.id } });
      toast.success("삭제되었습니다.");
      refetch();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const doRevokeAdmin = async (u: UserRow) => {
    if (!confirm(`${u.email} 의 관리자 권한을 회수하시겠습니까?`)) return;
    setBusyId(u.id);
    try {
      await revokeAdmin({ data: { userId: u.id } });
      toast.success("관리자 권한을 회수했습니다.");
      refetch();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const doRevertToPending = async (u: UserRow) => {
    if (!confirm(`${u.nickname || u.email} 을(를) 승인 대기 상태로 되돌리시겠습니까?`)) return;
    setBusyId(u.id);
    try {
      await revertToPending({ data: { userId: u.id } });
      toast.success("승인 대기로 되돌렸습니다.");
      refetch();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const doBulkApprove = async (role: "student" | "admin" | "instructor") => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!confirm(`${ids.length}명을 ${roleName(role)}(으)로 승인하시겠습니까?`)) return;
    setBulkBusy(true);
    try {
      const res: any = await bulkApproveUsers({ data: { userIds: ids, role } });

      toast.success(`${res?.count ?? ids.length}명이 승인되었습니다.`);
      setSelectedIds(new Set());
      refetch();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBulkBusy(false);
    }
  };

  const roleLabel = (u: UserRow) =>
    u.isAdmin ? "관리자" : u.isInstructor ? "강사" : u.isStudent ? "학생" : "승인 대기";
  const roleTone = (u: UserRow): "admin" | "instructor" | "student" | "pending" =>
    u.isAdmin ? "admin" : u.isInstructor ? "instructor" : u.isStudent ? "student" : "pending";


  return (
    <AdminOnly>
      <Card className="border-border/60">
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary">
            <Users className="h-4 w-4" />
          </span>
          <CardTitle className="text-lg">사용자 관리</CardTitle>
          {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <div className="ml-auto">
            {/* <Button
              size="sm"
              variant="outline"
              disabled={bulkBusy}
              onClick={async () => {
                if (!confirm("아직 계정이 없는 강사들에게 초기 비밀번호 12345678로 계정을 일괄 생성하시겠습니까?")) return;
                setBulkBusy(true);
                try {
                  const res: any = await bulkCreateInstructorAccounts();
                  toast.success(
                    `강사 계정 처리 완료 (신규 ${res.created}, 연결 ${res.linked}, 실패 ${res.failed} / 총 ${res.total})`,
                  );
                  refetch();
                } catch (err: any) {
                  toast.error(err.message ?? "일괄 생성에 실패했습니다.");
                } finally {
                  setBulkBusy(false);
                }
              }}
            >
              강사 계정 일괄 생성
            </Button> */}
          </div>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          새로 가입한 회원을 승인하거나 관리자 권한을 부여할 수 있습니다.
        </p>
      </CardHeader>

      <CardContent className="space-y-5">
        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v as TabKey);
            setSelectedIds(new Set());
            setCohortFilter("__all__");
          }}
        >
          <TabsList className="flex w-full max-w-2xl flex-nowrap gap-1 overflow-x-auto sm:grid sm:grid-cols-4 sm:gap-0 sm:overflow-visible">
            <TabsTrigger value="admin" className="shrink-0 gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" /> 관리자
              <span className="ml-1 rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold text-primary">
                {buckets.admin.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="instructor" className="shrink-0 gap-1.5">
              <GraduationCap className="h-3.5 w-3.5 shrink-0" /> 강사
              <span className="ml-1 rounded-full bg-sky-100 px-1.5 text-[10px] font-semibold text-sky-700">
                {buckets.instructor.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="student" className="shrink-0 gap-1.5">
              <GraduationCap className="h-3.5 w-3.5 shrink-0" /> 학생
              <span className="ml-1 rounded-full bg-accent px-1.5 text-[10px] font-semibold text-accent-foreground">
                {buckets.student.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="pending" className="shrink-0 gap-1.5">
              <Clock className="h-3.5 w-3.5 shrink-0" /> 승인 대기
              <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-700">
                {buckets.pending.length}
              </span>
            </TabsTrigger>
          </TabsList>

        </Tabs>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
            <ClearableSearchInput
              value={search}
              onChange={(v) => {
                setSearch(v);
                setPages({ admin: 1, instructor: 1, student: 1, pending: 1 });
              }}
              placeholder="이름, 전화번호, 이메일 검색"
              className="w-full max-w-sm"
            />
            <Select
              value={branchFilter}
              onValueChange={(v) => {
                setBranchFilter(v);
                setPages({ admin: 1, instructor: 1, student: 1, pending: 1 });
              }}
            >
              <SelectTrigger className="h-9 w-full sm:w-48">
                <SelectValue placeholder="교육원 전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">교육원 전체</SelectItem>
                {branchOptions.map((b) => (
                  <SelectItem key={b} value={b}>{b}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {tab === "instructor" && (
              <Select
                value={cohortFilter}
                onValueChange={(v) => {
                  setCohortFilter(v);
                  setPages({ admin: 1, instructor: 1, student: 1, pending: 1 });
                }}
              >
                <SelectTrigger className="h-9 w-full sm:w-40">
                  <SelectValue placeholder="기수 전체" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">기수 전체</SelectItem>
                  <SelectItem value="__none__">미지정</SelectItem>
                  {cohortOptions.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {/* <Button
              variant="outline"
              size="sm"
              className="h-9"
              onClick={runBackfill}
              disabled={backfillBusy}
            >
              {backfillBusy ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> 교육원 백필 중…</>
              ) : (
                "교육원 백필"
              )}
            </Button> */}
          </div>
        </div>

        {tab === "pending" && filtered.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm">
            <span className="text-amber-900">
              선택됨 <b>{selectedIds.size}</b>명 / 표시 {filtered.length}명
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={bulkBusy}
                onClick={() => {
                  const all = paged.map((u) => u.id);
                  const allSelected = all.length > 0 && all.every((id) => selectedIds.has(id));
                  setSelectedIds((prev) => {
                    const next = new Set(prev);
                    if (allSelected) all.forEach((id) => next.delete(id));
                    else all.forEach((id) => next.add(id));
                    return next;
                  });
                }}
              >
                {paged.length > 0 && paged.every((u) => selectedIds.has(u.id)) ? "현재 페이지 해제" : "현재 페이지 선택"}
              </Button>

              <Button
                size="sm"
                disabled={bulkBusy || selectedIds.size === 0}
                onClick={() => doBulkApprove("student")}
                className="gap-1"
              >
                <Check className="h-3.5 w-3.5" />
                {bulkBusy ? "처리 중..." : `학생 승인 (${selectedIds.size})`}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={bulkBusy || selectedIds.size === 0}
                onClick={() => doBulkApprove("instructor")}
                className="gap-1"
              >
                <Check className="h-3.5 w-3.5" />
                강사 승인 ({selectedIds.size})
              </Button>
            </div>
          </div>
        )}


        <div className="overflow-x-auto rounded-xl border border-border/60">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/40 text-left text-xs font-medium text-muted-foreground">
              <tr>
                {tab === "pending" && (
                  <th className="w-10 whitespace-nowrap px-4 py-3">
                    <Checkbox
                      checked={
                        paged.length > 0 &&
                        paged.every((u) => selectedIds.has(u.id))
                      }
                      onCheckedChange={(v) => {
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (v) paged.forEach((u) => next.add(u.id));
                          else paged.forEach((u) => next.delete(u.id));
                          return next;
                        });
                      }}
                    />
                  </th>
                )}

                <th className="min-w-[120px] whitespace-nowrap px-4 py-3">이름</th>
                <th className="min-w-[110px] whitespace-nowrap px-4 py-3">전화번호</th>
                <th className="min-w-[80px] whitespace-nowrap px-4 py-3">역할</th>
                {tab === "instructor" && (
                  <th className="min-w-[110px] whitespace-nowrap px-4 py-3">기수</th>
                )}

                <th className="min-w-[90px] whitespace-nowrap px-4 py-3">수강 중인 반</th>
                <th className="min-w-[100px] whitespace-nowrap px-4 py-3">가입일</th>
                <th className="min-w-[220px] whitespace-nowrap px-4 py-3 text-right">작업</th>
              </tr>
            </thead>
            <tbody>
              {paged.length === 0 ? (
                <tr>
                  <td colSpan={(tab === "pending" ? 7 : 6) + (tab === "instructor" ? 1 : 0)} className="px-4 py-10 text-center text-muted-foreground">
                    표시할 사용자가 없습니다.
                  </td>
                </tr>

              ) : (
                paged.map((u) => {

                  const busy = busyId === u.id;
                  return (
                    <tr key={u.id} className="border-t transition hover:bg-muted/30">
                      {tab === "pending" && (
                        <td className="w-10 whitespace-nowrap px-4 py-3">
                          <Checkbox
                            checked={selectedIds.has(u.id)}
                            onCheckedChange={(v) => {
                              setSelectedIds((prev) => {
                                const next = new Set(prev);
                                if (v) next.add(u.id);
                                else next.delete(u.id);
                                return next;
                              });
                            }}
                          />
                        </td>
                      )}
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                            {(u.nickname || u.email || "?").slice(0, 1).toUpperCase()}
                          </span>
                          <span className="truncate font-medium">{u.nickname || "-"}</span>
                          <BranchBadge branch={u.branch} />
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{u.phone || (u.email && !u.email.endsWith("@mirror.local") ? u.email : "-")}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <Badge tone={roleTone(u)}>{roleLabel(u)}</Badge>
                      </td>
                      {tab === "instructor" && (
                        <td className="whitespace-nowrap px-4 py-3">
                          <Select
                            value={(u as any).cohort ?? "__none__"}
                            onValueChange={async (v) => {
                              try {
                                await updateInstructorCohort({
                                  data: { authUserId: u.id, cohort: v === "__none__" ? null : v },
                                });
                                toast.success("기수가 저장되었습니다.");
                                refetch();
                                qc.invalidateQueries({ queryKey: ["admin", "instructors", "roster"] });
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
                      )}
                      <td className="whitespace-nowrap px-4 py-3">{u.class_count}개</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                        {u.created_at ? new Date(u.created_at).toLocaleDateString("ko-KR") : "-"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {u.isPending && (
                            <>
                              <Button
                                size="sm"
                                disabled={busy}
                                onClick={() => doApprove(u, "student")}
                                className="h-8 gap-1 px-2 text-xs"
                              >
                                <Check className="h-3.5 w-3.5" /> 학생 승인
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={busy}
                                onClick={() => doApprove(u, "instructor")}
                                className="h-8 gap-1 px-2 text-xs"
                              >
                                <Check className="h-3.5 w-3.5" /> 강사 승인
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() => doReject(u)}
                                className="h-8 gap-1 px-2 text-xs"
                              >
                                <X className="h-3.5 w-3.5" /> 거절
                              </Button>
                            </>
                          )}
                          {u.isAdmin && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => doRevokeAdmin(u)}
                              className="h-8 gap-1 px-2 text-xs"
                            >
                              <UserMinus className="h-3.5 w-3.5" /> 관리자 해제
                            </Button>
                          )}
                          {!u.isPending && (

                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => doRevertToPending(u)}
                              className="h-8 gap-1 px-2 text-xs"
                            >
                              <Clock className="h-3.5 w-3.5" /> 승인 대기로
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {filtered.length > 0 && (
          <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
            <p className="text-xs text-muted-foreground">
              총 <b>{filtered.length}</b>명 · {pageStart + 1}–
              {Math.min(pageStart + PAGE_SIZE, filtered.length)} 표시
            </p>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                disabled={safePage <= 1}
                onClick={() => setPage(1)}
              >
                처음
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={safePage <= 1}
                onClick={() => setPage(safePage - 1)}
              >
                이전
              </Button>
              <span className="px-2 text-sm">
                {safePage} / {totalPages}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={safePage >= totalPages}
                onClick={() => setPage(safePage + 1)}
              >
                다음
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={safePage >= totalPages}
                onClick={() => setPage(totalPages)}
              >
                마지막
              </Button>
            </div>
          </div>
        )}

      </CardContent>
    </Card>
    </AdminOnly>
  );
}
