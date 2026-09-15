import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import { keepPreviousData, queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
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
  ChevronRight,
} from "lucide-react";
import {
  listUsers,
  listStudentUsers,
  listStudentBranches,
  revokeAdmin,
  setBranchAdminRole,
  bulkCreateInstructorAccounts,
  updateInstructorCohort,
} from "@/lib/vimeo.functions";

import { COHORT_OPTIONS } from "@/lib/cohort";
import { backfillBranchesFromMaster } from "@/lib/branch-backfill.functions";
import { CANONICAL_BRANCHES, canonicalBranch, matchesBranch } from "@/lib/branch";
import { BranchBadge } from "@/components/BranchBadge";
import { AdminOnly, useAdminRole } from "@/components/AdminRole";
import { ClearableSearchInput } from "@/components/admin/ClearableSearchInput";
import { CohortMultiSelect } from "@/components/admin/CohortMultiSelect";
import { LocalStudentDialog } from "@/components/admin/LocalStudentDialog";
import { LocalInstructorDialog } from "@/components/admin/LocalInstructorDialog";
import { StudentLearningDetail } from "@/components/admin/StudentLearningDetail";
import { StudentPhoneDialog } from "@/components/admin/StudentPhoneDialog";



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
  isBranchAdmin: boolean;
  isPending: boolean;
  class_count: number;
  branch: string | null;
  cohort: string | null;
  cohorts: string[] | null;
  class_names?: string[];
};


const usersQueryOptions = queryOptions({
  queryKey: ["admin", "users"],
  queryFn: async () => (await listUsers()) as UserRow[],
  staleTime: 5 * 60_000,
  gcTime: 10 * 60_000,
});

type TabKey = "admin" | "branch_admin" | "instructor" | "student";


export const Route = createFileRoute("/admin/users")({
  component: UsersPage,
});

function Badge({
  tone,
  children,
}: {
  tone: "admin" | "branch_admin" | "instructor" | "student";
  children: React.ReactNode;
}) {
  const map = {
    admin: "bg-primary/10 text-primary border-primary/20",
    branch_admin: "bg-amber-100 text-amber-700 border-amber-200",
    instructor: "bg-sky-100 text-sky-700 border-sky-200",
    student: "bg-accent/60 text-accent-foreground border-accent",
  } as const;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${map[tone]}`}
    >
      {children}
    </span>
  );
}

const PAGE_SIZE = 500;

function UsersPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabKey>("student");
  const isStudentTab = tab === "student";
  const { data: users = [], isFetching: usersFetching } = useQuery({
    ...usersQueryOptions,
    enabled: !isStudentTab,
  });
  const { isAdmin: canManage, isBranchAdmin } = useAdminRole();

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState<string>("__all__");
  const [cohortFilter, setCohortFilter] = useState<string[]>([]);
  const [classFilter, setClassFilter] = useState<"all" | "has_class" | "no_class">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [backfillBusy, setBackfillBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);


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
  const [bulkBusy, setBulkBusy] = useState(false);
  const [pages, setPages] = useState<Record<TabKey, number>>({
    admin: 1,
    branch_admin: 1,
    instructor: 1,
    student: 1,
  });

  const page = pages[tab];
  const setPage = (p: number) =>
    setPages((prev) => ({ ...prev, [tab]: Math.max(1, p) }));

  const buckets = useMemo(() => {
    const admin: UserRow[] = [];
    const branch_admin: UserRow[] = [];
    const instructor: UserRow[] = [];
    const student: UserRow[] = [];
    for (const u of users) {
      if (u.isAdmin) admin.push(u);
      if (u.isBranchAdmin) branch_admin.push(u);
      if (u.isInstructor) instructor.push(u);
      if (u.isStudent) student.push(u);
    }
    return { admin, branch_admin, instructor, student };
  }, [users]);

  // 학생 탭: 서버 사이드 검색·페이지네이션 (전체 사용자 로딩 없이 빠르게 조회)
  const studentQuery = useQuery({
    queryKey: ["admin", "students", debouncedSearch, branchFilter, classFilter, page],
    queryFn: async () =>
      (await listStudentUsers({
        data: {
          search: debouncedSearch,
          branch: branchFilter === "__all__" ? "" : branchFilter,
          page,
          pageSize: PAGE_SIZE,
          classFilter,
        },
      })) as { total: number; rows: UserRow[] },
    enabled: isStudentTab,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  const studentBranchQuery = useQuery({
    queryKey: ["admin", "student-branches"],
    queryFn: async () => (await listStudentBranches()) as string[],
    enabled: isStudentTab,
    staleTime: 10 * 60_000,
  });

  const isFetching = isStudentTab ? studentQuery.isFetching : usersFetching;

  const derivedBranchOptions = useMemo(() => {
    const set = new Set<string>();
    users.forEach((u) => {
      const b = canonicalBranch(u.branch);
      if (b) set.add(b);
    });
    // 표준 교육원(상동·청라·송도)만 노출
    return CANONICAL_BRANCHES.filter((b) => set.has(b));
  }, [users]);

  const branchOptions: string[] = isStudentTab
    ? (studentBranchQuery.data ?? [])
    : [...derivedBranchOptions];

  const cohortOptions = useMemo(() => {
    const set = new Set<string>();
    buckets.instructor.forEach((u) => {
      (((u as any).cohorts ?? []) as string[]).forEach((c) => {
        const v = (c ?? "").trim();
        if (v) set.add(v);
      });
    });
    return Array.from(set).sort((a, b) => b.localeCompare(a, "ko"));
  }, [buckets.instructor]);


  const isStaffTab = tab === "instructor" || tab === "branch_admin";

  const filtered = useMemo(() => {
    if (isStudentTab) return studentQuery.data?.rows ?? [];
    const rows = buckets[tab];
    const terms = search
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 0)
      .slice(0, 10);
    const byBranch =
      branchFilter === "__all__"
        ? rows
        : rows.filter((u) => matchesBranch(branchFilter, u.branch));
    const byCohort =
      !(tab === "instructor" || tab === "branch_admin") || cohortFilter.length === 0
        ? byBranch
        : byBranch.filter((u) => {
            const list = ((u as any).cohorts ?? []) as string[];
            const matchesNone = cohortFilter.includes("__none__") && list.length === 0;
            const matchesCohort = list.some((c) => cohortFilter.includes(c));
            return matchesNone || matchesCohort;
          });
    if (terms.length === 0) return byCohort;
    return byCohort
      .filter((u) => {
        const haystack = `${u.email.toLowerCase()} ${u.nickname.toLowerCase()} ${(u.phone ?? "").toLowerCase()}`;
        return terms.some((term) => haystack.includes(term));
      })
      .sort((a, b) => {
        const aName = a.nickname.toLowerCase();
        const bName = b.nickname.toLowerCase();
        const aExact = terms.some((t) => aName === t);
        const bExact = terms.some((t) => bName === t);
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;
        return a.nickname.localeCompare(b.nickname, "ko");
      });
  }, [buckets, tab, search, branchFilter, cohortFilter, isStudentTab, studentQuery.data]);

  const studentTotal = studentQuery.data?.total ?? 0;
  const totalCount = isStudentTab ? studentTotal : filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pagedRaw = isStudentTab ? filtered : filtered.slice(pageStart, pageStart + PAGE_SIZE);
  // 동일 id가 중복으로 내려오면 React key 충돌로 이전 탭 행이 남는 문제가 생겨 중복 제거
  const paged = useMemo(() => {
    const seen = new Set<string>();
    return pagedRaw.filter((u) => (seen.has(u.id) ? false : (seen.add(u.id), true)));
  }, [pagedRaw]);


  const refetch = () => {
    qc.refetchQueries({ queryKey: ["admin", "users"] });
    qc.invalidateQueries({ queryKey: ["admin", "students"] });
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

  const doToggleBranchAdmin = async (u: UserRow, enabled: boolean) => {
    const name = u.nickname || u.email || "해당 사용자";
    if (
      !confirm(
        enabled
          ? `${name} 님을 중간 관리자로 승격하시겠습니까?`
          : `${name} 님의 중간 관리자 권한을 해제하시겠습니까?`,
      )
    )
      return;
    setBusyId(u.id);
    try {
      await setBranchAdminRole({ data: { userId: u.id, enabled } });
      toast.success(enabled ? "중간 관리자로 승격했습니다." : "중간 관리자 권한을 해제했습니다.");
      refetch();
    } catch (err: any) {
      toast.error(err?.message ?? "권한 변경 실패");
    } finally {
      setBusyId(null);
    }
  };

  const roleLabel = (u: UserRow) =>
    u.isAdmin
      ? "관리자"
      : u.isBranchAdmin
        ? "중간 관리자"
        : u.isInstructor
          ? "강사"
          : "학생";
  const roleTone = (u: UserRow): "admin" | "branch_admin" | "instructor" | "student" =>
    u.isAdmin
      ? "admin"
      : u.isBranchAdmin
        ? "branch_admin"
        : u.isInstructor
          ? "instructor"
          : "student";


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
          <div className="ml-auto flex items-center gap-2">
            {canManage && tab === "student" && <LocalStudentDialog onCreated={refetch} />}
            {canManage && tab === "instructor" && <LocalInstructorDialog onCreated={refetch} />}
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
            setCohortFilter([]);
          }}
        >
          <TabsList className="grid w-full grid-cols-2 gap-1 sm:grid-cols-4 sm:gap-0">
            <TabsTrigger value="admin" className="shrink-0 gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" /> 관리자
              <span className="ml-1 rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold text-primary">
                {buckets.admin.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="branch_admin" className="shrink-0 gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" /> 중간 관리자
              <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-700">
                {buckets.branch_admin.length}
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
                {isStudentTab ? studentTotal : buckets.student.length}
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
                setPages({ admin: 1, branch_admin: 1, instructor: 1, student: 1 });
              }}
              placeholder="이름, 전화번호, 이메일 (띄어쓰기로 여러 명 검색)"
              className="w-full max-w-sm"
            />
            <Select
              value={branchFilter}
              onValueChange={(v) => {
                setBranchFilter(v);
                setPages({ admin: 1, branch_admin: 1, instructor: 1, student: 1 });
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
            {isStudentTab && (
              <Select
                value={classFilter}
                onValueChange={(v) => {
                  setClassFilter(v as "all" | "has_class" | "no_class");
                  setPages({ admin: 1, branch_admin: 1, instructor: 1, student: 1 });
                }}
              >
                <SelectTrigger className="h-9 w-full sm:w-44">
                  <SelectValue placeholder="수강반 전체" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">수강반 전체</SelectItem>
                  <SelectItem value="has_class">수강반 있음</SelectItem>
                  <SelectItem value="no_class">수강반 없음</SelectItem>
                </SelectContent>
              </Select>
            )}
            {isStaffTab && (
              <CohortMultiSelect
                options={cohortOptions.length > 0 ? cohortOptions : COHORT_OPTIONS}
                selected={cohortFilter}
                onChange={(v) => {
                  setCohortFilter(v);
                  setPages({ admin: 1, branch_admin: 1, instructor: 1, student: 1 });
                }}
                placeholder="기수 전체"
              />
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





        <div className="rounded-xl border border-border/60">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs font-medium text-muted-foreground">
              <tr>
                <th className="px-3 py-2 sm:px-4">이름</th>
                <th className="hidden px-3 py-2 sm:table-cell">전화번호</th>
                <th className="px-3 py-2">역할</th>
                {isStaffTab && (
                  <th className="hidden px-3 py-2 sm:table-cell">기수</th>
                )}
                {isStaffTab && (
                  <th className="hidden px-3 py-2 md:table-cell">배정 수강반</th>
                )}
                {!isStaffTab && (
                  <th className="hidden px-3 py-2 sm:table-cell">수강 중인 반</th>
                )}
                <th className="hidden px-3 py-2 text-xs text-muted-foreground md:table-cell">가입일</th>
                <th className="px-3 py-2 text-right sm:px-4">작업</th>
              </tr>
            </thead>
            <tbody>
              {paged.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                    표시할 사용자가 없습니다.
                  </td>
                </tr>

              ) : (
                paged.map((u) => {

                  const busy = busyId === u.id;
                  const expanded = expandedId === u.id;
                  return (
                    <Fragment key={`${tab}-${u.id}`}>
                    <tr className="border-t transition hover:bg-muted/30">


                      <td className="px-3 py-2 sm:px-4">
                        <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
                          {isStudentTab && (
                            <button
                              type="button"
                              onClick={() => setExpandedId(expanded ? null : u.id)}
                              aria-label={expanded ? "학습 이력 닫기" : "학습 이력 열기"}
                              className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted"
                            >
                              <ChevronRight
                                className={`h-4 w-4 transition-transform ${expanded ? "rotate-90" : ""}`}
                              />
                            </button>
                          )}
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                            {(u.nickname || u.email || "?").slice(0, 1).toUpperCase()}
                          </span>
                          <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2.5">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <span className="truncate font-medium">{u.nickname || "-"}</span>
                              <BranchBadge branch={u.branch} />
                            </div>
                            <span className="truncate text-xs text-muted-foreground sm:hidden">
                              {u.phone || (u.email && !u.email.endsWith("@mirror.local") ? u.email : "-")}
                            </span>
                          </div>
                        </div>
                      </td>

                      <td className="hidden whitespace-nowrap px-3 py-2 text-muted-foreground sm:table-cell">{u.phone || (u.email && !u.email.endsWith("@mirror.local") ? u.email : "-")}</td>
                      <td className="px-3 py-2 sm:px-4">
                        <Badge tone={roleTone(u)}>{roleLabel(u)}</Badge>
                      </td>
                      {isStaffTab && (
                        <td className="hidden whitespace-nowrap px-3 py-2 sm:table-cell">
                          <span className="text-xs text-muted-foreground">
                            {(() => {
                              const cohorts = (((u as any).cohorts ?? []) as string[]);
                              const isAllCohorts = cohorts.length === COHORT_OPTIONS.length &&
                                COHORT_OPTIONS.every((c) => cohorts.includes(c));
                              if (isAllCohorts) return "전 기수";
                              return cohorts.join(", ") || "미지정";
                            })()}
                          </span>
                        </td>
                      )}
                      {isStaffTab && (
                        <td className="hidden px-3 py-2 md:table-cell">
                          {u.class_names && u.class_names.length > 0 ? (
                            <div className="flex max-w-[240px] flex-wrap gap-1">
                              {u.class_names.map((cn) => (
                                <span
                                  key={cn}
                                  className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                                >
                                  {cn}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </td>
                      )}
                      {!isStaffTab && (
                        <td className="hidden whitespace-nowrap px-3 py-2 sm:table-cell">{u.class_count}개</td>
                      )}
                      <td className="hidden whitespace-nowrap px-3 py-2 text-xs text-muted-foreground md:table-cell">
                        {u.created_at ? new Date(u.created_at).toLocaleDateString("ko-KR") : "-"}
                      </td>
                      <td className="px-3 py-2 sm:px-4">
                        <div className="flex flex-col items-end gap-1.5 sm:flex-row sm:flex-wrap sm:justify-end">
                          {isStudentTab && (canManage || isBranchAdmin) && (
                            <StudentPhoneDialog
                              authUserId={u.id}
                              name={u.nickname || "학생"}
                              phone={((u as any).rawPhone ?? "") as string}
                              parentPhone={((u as any).rawParentPhone ?? "") as string}
                              onSaved={() => studentQuery.refetch()}
                            />
                          )}
                          {canManage && isStaffTab && !u.isAdmin && (
                            <Button
                              size="sm"
                              variant={u.isBranchAdmin ? "outline" : "default"}
                              disabled={busy}
                              onClick={() => doToggleBranchAdmin(u, !u.isBranchAdmin)}
                              className="h-8 gap-1 px-2 text-xs"
                            >
                              {busy ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <ShieldCheck className="h-3.5 w-3.5" />
                              )}
                              {u.isBranchAdmin ? "중간 관리자 해제" : "중간 관리자 승격"}
                            </Button>
                          )}
                          {canManage && u.isAdmin && (
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
                        </div>
                      </td>
                    </tr>
                    {isStudentTab && expanded && (
                      <tr className="border-t bg-muted/20">
                        <td colSpan={6} className="p-0">
                          <StudentLearningDetail userId={u.id} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {totalCount > 0 && (
          <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
            <p className="text-xs text-muted-foreground">
              총 <b>{totalCount}</b>명 · {pageStart + 1}–
              {Math.min(pageStart + PAGE_SIZE, totalCount)} 표시
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
