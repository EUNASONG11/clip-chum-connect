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
  Search,
} from "lucide-react";
import {
  listUsers,
  revokeAdmin,
  approveUser,
  rejectUser,
  bulkApproveUsers,
  revertToPending,
  bulkCreateInstructorAccounts,
  issueStudentTempPassword,
  getStudentTempPasswordInfo,
} from "@/lib/vimeo.functions";
import { AdminOnly } from "@/components/AdminRole";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

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
  has_temp_password: boolean;
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
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [tempPwUser, setTempPwUser] = useState<UserRow | null>(null);
  const [tempPwInfo, setTempPwInfo] = useState<{
    currentTempPassword: string | null;
    history: { id: string; temp_password: string; created_at: string; issued_by_email: string | null }[];
  } | null>(null);
  const [tempPwLoading, setTempPwLoading] = useState(false);
  const [tempPwIssuing, setTempPwIssuing] = useState(false);
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


  const filtered = useMemo(() => {
    const rows = buckets[tab];
    const terms = search
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 0);
    if (terms.length === 0) return rows;
    return rows.filter((u) => {
      const haystack = `${u.email.toLowerCase()} ${u.nickname.toLowerCase()} ${(u.phone ?? "").toLowerCase()}`;
      return terms.some((term) => haystack.includes(term));
    });
  }, [buckets, tab, search]);

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

  const openTempPwDialog = async (u: UserRow) => {
    setTempPwUser(u);
    setTempPwInfo(null);
    setTempPwLoading(true);
    try {
      const info = await getStudentTempPasswordInfo({ data: { userId: u.id } });
      setTempPwInfo({
        currentTempPassword: info.currentTempPassword,
        history: info.history,
      });
    } catch (err: any) {
      toast.error(err.message ?? "조회에 실패했습니다.");
      setTempPwUser(null);
    } finally {
      setTempPwLoading(false);
    }
  };

  const doIssueTempPassword = async (u: UserRow) => {
    if (!confirm(`${u.nickname || "학생"} 님에게 임시 비밀번호를 ${u.has_temp_password ? "재" : ""}발급하시겠습니까?\n기존 비밀번호는 재설정되며, 새 임시코드로만 로그인할 수 있습니다.`)) return;
    setTempPwIssuing(true);
    try {
      await issueStudentTempPassword({ data: { userId: u.id } });
      toast.success("임시 비밀번호가 발급되었습니다.");
      const info = await getStudentTempPasswordInfo({ data: { userId: u.id } });
      setTempPwInfo({
        currentTempPassword: info.currentTempPassword,
        history: info.history,
      });
      refetch();
    } catch (err: any) {
      toast.error(err.message ?? "발급에 실패했습니다.");
    } finally {
      setTempPwIssuing(false);
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
            <Button
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
            </Button>
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
          }}
        >
          <TabsList className="grid w-full max-w-2xl grid-cols-4">
            <TabsTrigger value="admin" className="gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" /> 관리자
              <span className="ml-1 rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold text-primary">
                {buckets.admin.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="instructor" className="gap-1.5">
              <GraduationCap className="h-3.5 w-3.5" /> 강사
              <span className="ml-1 rounded-full bg-sky-100 px-1.5 text-[10px] font-semibold text-sky-700">
                {buckets.instructor.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="student" className="gap-1.5">
              <GraduationCap className="h-3.5 w-3.5" /> 학생
              <span className="ml-1 rounded-full bg-accent px-1.5 text-[10px] font-semibold text-accent-foreground">
                {buckets.student.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="pending" className="gap-1.5">
              <Clock className="h-3.5 w-3.5" /> 승인 대기
              <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-700">
                {buckets.pending.length}
              </span>
            </TabsTrigger>
          </TabsList>

        </Tabs>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPages({ admin: 1, instructor: 1, student: 1, pending: 1 });
              }}
              placeholder="이름, 전화번호, 이메일 검색"
              className="pl-9"
            />

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
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs font-medium text-muted-foreground">
              <tr>
                {tab === "pending" && (
                  <th className="w-10 px-4 py-3">
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

                <th className="px-4 py-3">이름</th>
                <th className="px-4 py-3">전화번호</th>
                <th className="px-4 py-3">역할</th>

                <th className="px-4 py-3">수강 중인 반</th>
                <th className="px-4 py-3">가입일</th>
                <th className="px-4 py-3 text-right">작업</th>
              </tr>
            </thead>
            <tbody>
              {paged.length === 0 ? (
                <tr>
                  <td colSpan={tab === "pending" ? 7 : 6} className="px-4 py-10 text-center text-muted-foreground">
                    표시할 사용자가 없습니다.
                  </td>
                </tr>

              ) : (
                paged.map((u) => {

                  const busy = busyId === u.id;
                  return (
                    <tr key={u.id} className="border-t transition hover:bg-muted/30">
                      {tab === "pending" && (
                        <td className="w-10 px-4 py-3">
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
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <span className="grid h-8 w-8 place-items-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                            {(u.nickname || u.email || "?").slice(0, 1).toUpperCase()}
                          </span>
                          <span className="font-medium">{u.nickname || "-"}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{u.phone || (u.email && !u.email.endsWith("@mirror.local") ? u.email : "-")}</td>
                      <td className="px-4 py-3">
                        <Badge tone={roleTone(u)}>{roleLabel(u)}</Badge>
                      </td>
                      <td className="px-4 py-3">{u.class_count}개</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {u.created_at ? new Date(u.created_at).toLocaleDateString("ko-KR") : "-"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1.5">
                          {u.isPending && (
                            <>
                              <Button
                                size="sm"
                                disabled={busy}
                                onClick={() => doApprove(u, "student")}
                                className="gap-1"
                              >
                                <Check className="h-3.5 w-3.5" /> 학생 승인
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={busy}
                                onClick={() => doApprove(u, "instructor")}
                                className="gap-1"
                              >
                                <Check className="h-3.5 w-3.5" /> 강사 승인
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() => doReject(u)}
                                className="gap-1"
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
                              className="gap-1"
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
                              className="gap-1"
                            >
                              <Clock className="h-3.5 w-3.5" /> 승인 대기로
                            </Button>
                          )}
                          {u.isStudent && !u.phone && (
                            <Button
                              size="sm"
                              variant={u.has_temp_password ? "secondary" : "outline"}
                              disabled={busy}
                              onClick={() => openTempPwDialog(u)}
                              className="gap-1"
                              title="전화번호가 없는 학생의 임시 비밀번호를 조회하거나 발급합니다"
                            >
                              {u.has_temp_password ? "임시 비밀번호 발급됨" : "임시 비밀번호 미발급"}
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

    <Dialog
      open={!!tempPwUser}
      onOpenChange={(open) => {
        if (!open) {
          setTempPwUser(null);
          setTempPwInfo(null);
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {tempPwUser?.nickname || "학생"} · 임시 비밀번호
          </DialogTitle>
        </DialogHeader>

        {tempPwLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중...
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/40 p-3">
              <div className="text-xs text-muted-foreground">현재 임시 비밀번호</div>
              <div className="mt-1 flex items-center gap-2">
                <code className="rounded bg-background px-2 py-1 font-mono text-base">
                  {tempPwInfo?.currentTempPassword ?? "미발급"}
                </code>
                {tempPwInfo?.currentTempPassword && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(tempPwInfo.currentTempPassword!);
                      toast.success("복사되었습니다.");
                    }}
                  >
                    복사
                  </Button>
                )}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                로그인: 이름 + 위 8자리 코드
              </p>
            </div>

            <div>
              <div className="mb-2 text-xs font-medium text-muted-foreground">
                발급 이력 (최근 {tempPwInfo?.history.length ?? 0}건)
              </div>
              <div className="max-h-64 overflow-y-auto rounded-lg border">
                {tempPwInfo && tempPwInfo.history.length > 0 ? (
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 text-left text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">일시</th>
                        <th className="px-3 py-2">비밀번호</th>
                        <th className="px-3 py-2">발급자</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tempPwInfo.history.map((h) => (
                        <tr key={h.id} className="border-t">
                          <td className="px-3 py-2 text-muted-foreground">
                            {new Date(h.created_at).toLocaleString("ko-KR")}
                          </td>
                          <td className="px-3 py-2 font-mono">{h.temp_password}</td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {h.issued_by_email ?? "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                    발급 이력이 없습니다.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setTempPwUser(null);
              setTempPwInfo(null);
            }}
          >
            닫기
          </Button>
          <Button
            disabled={tempPwIssuing || tempPwLoading || !tempPwUser}
            onClick={() => tempPwUser && doIssueTempPassword(tempPwUser)}
          >
            {tempPwIssuing ? (
              <>
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> 처리 중...
              </>
            ) : tempPwInfo?.currentTempPassword ? (
              "임시 비밀번호 재발급"
            ) : (
              "임시 비밀번호 발급"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </AdminOnly>
  );
}
