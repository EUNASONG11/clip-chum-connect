import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  ArrowLeft, UserPlus, X, Film, BarChart3, Search, ArrowUp, ArrowDown,
  GraduationCap, FolderPlus, Folder, Pencil, Trash2, Loader2, History, MessageSquare,
} from "lucide-react";
import { SendMessageDialog } from "@/components/admin/SendMessageDialog";
import {
  getClass,
  listClassStudents,
  searchStudentsByNameOrPhone,
  assignStudent,
  unassignStudent,
  listClassVideos,
  swapVideoOrder,
  listClassInstructors,
  searchInstructors,
  assignInstructor,
  unassignInstructor,
  listClassFolders,
  createClassFolder,
  updateClassFolder,
  deleteClassFolder,
  setVideoFolder,
  listClassEnrollmentHistory,
  updateClass,
  listStudentBranches,
} from "@/lib/classes.functions";

import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { getClassStudentStats, getStudentVideoDetail } from "@/lib/stats.functions";

function StudentVideoDetail({ classId, userId }: { classId: string; userId: string }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ["admin", "class", classId, "student-video-detail", userId],
    queryFn: () => getStudentVideoDetail({ data: { classId, userId } }),
  });
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중...
      </div>
    );
  }
  if (data.length === 0) {
    return <p className="px-3 py-3 text-sm text-muted-foreground">시청 대상 영상이 없습니다.</p>;
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-muted/40 p-3">
      {data.map((v: any) => (
        <div key={v.video_id} className="flex items-center gap-3 rounded-md bg-background px-3 py-2">
          <Film className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm">{v.title}</span>
          <div className="hidden h-2 w-28 overflow-hidden rounded-full bg-muted sm:block">
            <div
              className={`h-full ${v.is_completed ? "bg-green-500" : "bg-primary"}`}
              style={{ width: `${Math.round(v.watched_ratio * 100)}%` }}
            />
          </div>
          <span className="w-12 shrink-0 text-right text-sm tabular-nums">
            {Math.round(v.watched_ratio * 100)}%
          </span>
          <span className={`w-16 shrink-0 text-right text-xs ${v.is_completed ? "text-green-600" : "text-muted-foreground"}`}>
            {v.is_completed ? "완료" : v.watched_ratio > 0 ? "시청 중" : "미시청"}
          </span>
          <span className="hidden w-36 shrink-0 text-right text-xs text-muted-foreground md:block">
            {v.updated_at ? new Date(v.updated_at).toLocaleString("ko-KR") : "-"}
          </span>
        </div>
      ))}
    </div>
  );
}

import { useAdminRole } from "@/components/AdminRole";
import { VideoThumb } from "@/components/VideoThumb";
import { BranchBadge } from "@/components/BranchBadge";

export const Route = createFileRoute("/admin/classes/$id")({
  component: ClassDetailPage,
});

function ClassDetailPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const { isAdmin } = useAdminRole();
  const { data: cls } = useQuery({
    queryKey: ["admin", "class", id],
    queryFn: () => getClass({ data: { id } }),
  });
  const { data: students = [] } = useQuery({
    queryKey: ["admin", "class", id, "students"],
    queryFn: () => listClassStudents({ data: { classId: id } }),
  });
  const { data: videos = [] } = useQuery({
    queryKey: ["admin", "class", id, "videos"],
    queryFn: () => listClassVideos({ data: { classId: id } }),
  });
  const { data: studentStats = [] } = useQuery({
    queryKey: ["admin", "class", id, "student-stats"],
    queryFn: () => getClassStudentStats({ data: { classId: id } }),
  });
  const { data: folders = [] } = useQuery({
    queryKey: ["admin", "class", id, "folders"],
    queryFn: () => listClassFolders({ data: { classId: id } }),
  });
  const { data: history = [] } = useQuery({
    queryKey: ["admin", "class", id, "history"],
    queryFn: () => listClassEnrollmentHistory({ data: { classId: id } }),
  });

  const [newFolderName, setNewFolderName] = useState("");
  const [creatingUnder, setCreatingUnder] = useState<string | null | undefined>(undefined);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState("");
  const [settingsFrom, setSettingsFrom] = useState("");
  const [settingsTo, setSettingsTo] = useState("");
  const [settingsAlways, setSettingsAlways] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [messageDialogOpen, setMessageDialogOpen] = useState(false);
  const [statsFilter, setStatsFilter] = useState<"all" | "completed" | "incomplete">("all");
  const [historySearch, setHistorySearch] = useState("");
  const [historyPageSize, setHistoryPageSize] = useState(20);
  const [historyPage, setHistoryPage] = useState(1);


  const clsAny: any = cls;
  useEffect(() => {
    if (clsAny) {
      const always = !clsAny.active_from && !clsAny.active_to;
      setSettingsAlways(always);
      setSettingsFrom(clsAny.active_from ?? "");
      setSettingsTo(clsAny.active_to ?? "");
    }
  }, [clsAny?.active_from, clsAny?.active_to]);


  const saveSettings = async () => {
    if (!settingsAlways) {
      if (!settingsFrom || !settingsTo) return toast.error("시작일과 종료일을 모두 입력하거나 상시 활성을 체크하세요.");
      if (settingsFrom > settingsTo) return toast.error("종료일은 시작일보다 이후여야 합니다.");
    }
    setSavingSettings(true);
    try {
      await updateClass({
        data: {
          id,
          active_from: settingsAlways ? null : settingsFrom,
          active_to: settingsAlways ? null : settingsTo,
        },
      });
      toast.success("저장되었습니다.");
      qc.invalidateQueries({ queryKey: ["admin", "class", id] });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSavingSettings(false);
    }
  };


  const refreshVideosAndFolders = () => {
    qc.invalidateQueries({ queryKey: ["admin", "class", id, "videos"] });
    qc.invalidateQueries({ queryKey: ["admin", "class", id, "folders"] });
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim() || isCreatingFolder) return;
    setIsCreatingFolder(true);
    try {
      await createClassFolder({
        data: {
          classId: id,
          name: newFolderName.trim(),
          ...(creatingUnder ? { parentFolderId: creatingUnder } : {}),
        },
      });
      setNewFolderName("");
      setCreatingUnder(undefined);
      refreshVideosAndFolders();
      toast.success("폴더가 생성되었습니다.");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsCreatingFolder(false);
    }
  };

  const handleRenameFolder = async (folderId: string) => {
    if (!editingFolderName.trim()) return;
    try {
      await updateClassFolder({ data: { id: folderId, name: editingFolderName.trim() } });
      setEditingFolderId(null);
      setEditingFolderName("");
      refreshVideosAndFolders();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleDeleteFolder = async (folderId: string) => {
    if (!confirm("이 폴더를 삭제하시겠습니까? 폴더 내 영상은 폴더 미지정 상태로 남습니다.")) return;
    try {
      await deleteClassFolder({ data: { id: folderId } });
      refreshVideosAndFolders();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleAssignVideoToFolder = async (videoId: string, folderId: string | null) => {
    try {
      await setVideoFolder({ data: { videoId, folderId } });
      refreshVideosAndFolders();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // 영상 드래그 앤 드롭으로 폴더 이동
  const [draggingVideoId, setDraggingVideoId] = useState<string | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null | undefined>(undefined);

  const handleDropOnFolder = async (folderId: string | null) => {
    const vid = draggingVideoId;
    setDraggingVideoId(null);
    setDragOverFolder(undefined);
    if (!vid) return;
    const current = (videos as any[]).find((v) => v.id === vid);
    if (!current || (current.folder_id ?? null) === folderId) return;
    await handleAssignVideoToFolder(vid, folderId);
    toast.success("영상을 이동했습니다.");
  };

  const [query, setQuery] = useState("");
  const [searchBranch, setSearchBranch] = useState<string>("__all__");
  const [results, setResults] = useState<
    { user_id: string; name: string; phone: string; parent_phone: string; school: string; grade: string; branch: string }[]
  >([]);
  const [searching, setSearching] = useState(false);
  const { data: branchList = [] } = useQuery({
    queryKey: ["student-branches"],
    queryFn: () => listStudentBranches(),
    staleTime: 5 * 60 * 1000,
  });

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    try {
      const rows = await searchStudentsByNameOrPhone({
        data: {
          query: query.trim(),
          ...(searchBranch !== "__all__" ? { branch: searchBranch } : {}),
        },
      });
      setResults(rows);
      if (rows.length === 0) toast.info("일치하는 학생이 없습니다.");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSearching(false);
    }
  };

  const assign = async (userId: string) => {
    try {
      await assignStudent({ data: { classId: id, userId } });
      qc.invalidateQueries({ queryKey: ["admin", "class", id, "students"] });
      qc.invalidateQueries({ queryKey: ["admin", "class", id, "history"] });
      setResults((r) => r.filter((s) => s.user_id !== userId));
      toast.success("배정되었습니다.");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const remove = async (userId: string) => {
    try {
      await unassignStudent({ data: { classId: id, userId } });
      qc.invalidateQueries({ queryKey: ["admin", "class", id, "students"] });
      qc.invalidateQueries({ queryKey: ["admin", "class", id, "history"] });
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // 강사 배정 상태
  const { data: assignedInstructors = [] } = useQuery({
    queryKey: ["admin", "class", id, "instructors"],
    queryFn: () => listClassInstructors({ data: { classId: id } }),
  });
  const [iq, setIq] = useState("");
  const [iResults, setIResults] = useState<{ user_id: string; name: string; email: string }[]>([]);
  const [iSearching, setISearching] = useState(false);

  const searchI = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!iq.trim()) return;
    setISearching(true);
    try {
      const rows = await searchInstructors({ data: { query: iq.trim() } });
      setIResults(rows);
      if (rows.length === 0) toast.info("일치하는 강사가 없습니다.");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setISearching(false);
    }
  };
  const assignI = async (userId: string) => {
    try {
      await assignInstructor({ data: { classId: id, userId } });
      qc.invalidateQueries({ queryKey: ["admin", "class", id, "instructors"] });
      setIResults((r) => r.filter((s) => s.user_id !== userId));
      toast.success("강사가 배정되었습니다.");
    } catch (err: any) {
      toast.error(err.message);
    }
  };
  const filteredStudentStats = useMemo(() => {
    if (statsFilter === "all") return studentStats;
    return (studentStats as any[]).filter((s) => {
      const isCompleted = s.video_total > 0 && s.completed === s.video_total;
      return statsFilter === "completed" ? isCompleted : !isCompleted;
    });
  }, [studentStats, statsFilter]);

  const [statsPageSize, setStatsPageSize] = useState(20);
  const [statsPage, setStatsPage] = useState(1);
  const statsTotalPages = Math.max(1, Math.ceil(filteredStudentStats.length / statsPageSize));
  useEffect(() => {
    setStatsPage(1);
  }, [statsFilter, filteredStudentStats.length, statsPageSize]);
  const pagedStudentStats = useMemo(
    () =>
      (filteredStudentStats as any[]).slice(
        (statsPage - 1) * statsPageSize,
        statsPage * statsPageSize,
      ),
    [filteredStudentStats, statsPage, statsPageSize],
  );


  // 반 평균 학습 시청률 요약
  const statRows = studentStats as any[];
  const classAvgRatio =
    statRows.length > 0
      ? statRows.reduce((sum, r) => sum + Number(r.avg_watched_ratio ?? 0), 0) / statRows.length
      : 0;
  const classCompletionRate = (() => {
    const total = statRows.reduce((sum, r) => sum + Number(r.video_total ?? 0), 0);
    const done = statRows.reduce((sum, r) => sum + Number(r.completed ?? 0), 0);
    return total > 0 ? done / total : 0;
  })();
  const activeLearners = statRows.filter((r) => Number(r.avg_watched_ratio ?? 0) > 0).length;

  const removeI = async (userId: string) => {
    try {
      await unassignInstructor({ data: { classId: id, userId } });
      qc.invalidateQueries({ queryKey: ["admin", "class", id, "instructors"] });
    } catch (err: any) {
      toast.error(err.message);
    }
  };



  return (
    <div className="min-w-0 space-y-6">
      <div className="min-w-0">
        <Button asChild variant="ghost" size="sm" className="max-w-full">
          <Link to="/admin/classes" className="min-w-0">
            <ArrowLeft className="mr-1 h-4 w-4 shrink-0" /> <span className="truncate">수강반 목록</span>
          </Link>
        </Button>
        <div className="mt-2 flex min-w-0 flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-baseline gap-2">
            <h1 className="truncate text-2xl font-bold">{cls?.name ?? "..."}</h1>
            {cls?.description && (
              <p className="min-w-0 truncate text-sm text-muted-foreground">{cls.description}</p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMessageDialogOpen(true)}
            className="shrink-0"
          >
            <MessageSquare className="mr-1 h-4 w-4" /> 문자 전송
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground">반 평균 학습 시청률</p>
          <p className="mt-1 text-2xl font-bold text-primary">
            {(classAvgRatio * 100).toFixed(1)}%
          </p>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.min(100, classAvgRatio * 100)}%` }}
            />
          </div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground">영상 완료율</p>
          <p className="mt-1 text-2xl font-bold">{(classCompletionRate * 100).toFixed(1)}%</p>
          <p className="mt-1 text-xs text-muted-foreground">완료 영상 / 배정 영상 합계</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground">학습 참여 학생</p>
          <p className="mt-1 text-2xl font-bold">
            {activeLearners}
            <span className="text-base font-normal text-muted-foreground"> / {statRows.length}명</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">1회 이상 시청한 학생 수</p>
        </div>
      </div>

      <SendMessageDialog
        open={messageDialogOpen}
        onOpenChange={setMessageDialogOpen}
        classId={id}
      />

      <Tabs defaultValue="students" className="w-full min-w-0">
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="students" className="whitespace-nowrap px-2 text-xs sm:text-sm">학생 배정</TabsTrigger>
          <TabsTrigger value="instructors" className="whitespace-nowrap px-2 text-xs sm:text-sm">강사 배정</TabsTrigger>
          <TabsTrigger value="videos" className="whitespace-nowrap px-2 text-xs sm:text-sm">영상</TabsTrigger>
          <TabsTrigger value="stats" className="whitespace-nowrap px-2 text-xs sm:text-sm">학습 현황</TabsTrigger>
          <TabsTrigger value="history" className="whitespace-nowrap px-2 text-xs sm:text-sm">배정 이력</TabsTrigger>
          <TabsTrigger value="settings" className="whitespace-nowrap px-2 text-xs sm:text-sm">설정</TabsTrigger>
        </TabsList>


        <TabsContent value="students">
      <Card>
        <CardHeader>
            <CardTitle className="flex min-w-0 items-center gap-2">
              <UserPlus className="h-5 w-5 shrink-0" /> <span className="truncate">학생 배정 ({students.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={search} className="space-y-2">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <div className="min-w-0">
                <Label htmlFor="query" className="sr-only">이름 또는 전화번호</Label>
                <Input
                  id="query"
                  type="text"
                  placeholder="이름 또는 전화번호로 검색"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={searching} className="shrink-0 whitespace-nowrap">
                <Search className="mr-1 h-4 w-4 shrink-0" />
                {searching ? "검색 중..." : "검색"}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground shrink-0">교육원</Label>
              <Select value={searchBranch} onValueChange={setSearchBranch}>
                <SelectTrigger className="h-9 w-full sm:w-56">
                  <SelectValue placeholder="전체" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">전체</SelectItem>
                  {branchList.map((b) => (
                    <SelectItem key={b} value={b}>{b}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </form>

          {results.length > 0 && (
            <div className="rounded-md border">
              <ul className="divide-y">
                {results.map((r) => {
                  const already = students.some((s: any) => s.user_id === r.user_id);
                  return (
                    <li key={r.user_id} className="flex items-center gap-2 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                          <span className="truncate">{r.name}</span>
                          <BranchBadge branch={r.branch} />
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {r.phone}
                          {r.parent_phone ? ` · 학부모 ${r.parent_phone}` : ""}
                          {r.school ? ` · ${r.school}` : ""}
                          {r.grade ? ` ${r.grade}` : ""}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => assign(r.user_id)}
                        disabled={already}
                      >
                        {already ? "배정됨" : "배정"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {students.length === 0 ? (
            <p className="text-sm text-muted-foreground">아직 배정된 학생이 없습니다.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {students.map((s: any) => (
                <div
                  key={s.user_id}
                  className="flex items-center gap-2 rounded-md border bg-green-500/15 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                      <span className="truncate">{s.name || s.email}</span>
                      <BranchBadge branch={s.branch} />
                    </p>
                    {s.phone && (
                      <p className="truncate text-xs text-muted-foreground">{s.phone}</p>
                    )}
                    {s.parent_phone && (
                      <p className="truncate text-xs text-muted-foreground">학부모 {s.parent_phone}</p>
                    )}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0"
                    onClick={() => remove(s.user_id)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

        </CardContent>
      </Card>
        </TabsContent>

      {(
        <TabsContent value="instructors">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GraduationCap className="h-5 w-5 shrink-0" /> <span className="truncate">강사 배정 ({assignedInstructors.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              배정된 강사는 이 수강반의 학생/영상/진도를 조회하고 관리할 수 있습니다.
            </p>
            <form onSubmit={searchI} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <div className="min-w-0">
                <Label htmlFor="iquery" className="sr-only">이름 또는 이메일</Label>
                <Input
                  id="iquery"
                  type="text"
                  placeholder="강사 이름 또는 이메일로 검색"
                  value={iq}
                  onChange={(e) => setIq(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={iSearching} className="shrink-0 whitespace-nowrap">
                <Search className="mr-1 h-4 w-4 shrink-0" />
                {iSearching ? "검색 중..." : "검색"}
              </Button>
            </form>

            {iResults.length > 0 && (
              <div className="rounded-md border">
                <ul className="divide-y">
                  {iResults.map((r) => {
                    const already = assignedInstructors.some((s: any) => s.user_id === r.user_id);
                    return (
                      <li key={r.user_id} className="flex items-center gap-2 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{r.name || "-"}</p>
                          <p className="truncate text-xs text-muted-foreground">{r.email}</p>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => assignI(r.user_id)}
                          disabled={already}
                        >
                          {already ? "배정됨" : "배정"}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {assignedInstructors.length === 0 ? (
              <p className="text-sm text-muted-foreground">아직 배정된 강사가 없습니다.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {assignedInstructors.map((s: any) => (
                  <div
                    key={s.user_id}
                    className="flex items-center gap-2 rounded-md border bg-green-500/15 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{s.name || "-"}</p>
                      <p className="truncate text-xs text-muted-foreground">{s.email}</p>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 shrink-0"
                      onClick={() => removeI(s.user_id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        </TabsContent>
      )}


        <TabsContent value="videos">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Film className="h-5 w-5 shrink-0" /> <span className="truncate">이 수강반의 영상 ({videos.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 폴더 관리 */}
          {creatingUnder === undefined ? (
            <Button size="sm" variant="outline" onClick={() => setCreatingUnder(null)} className="whitespace-nowrap">
              <FolderPlus className="mr-1 h-4 w-4 shrink-0" /> 폴더 추가
            </Button>
          ) : creatingUnder === null ? (
            <form onSubmit={handleCreateFolder} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
              <Input
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="폴더 이름 (예: 1주차)"
                disabled={isCreatingFolder}
              />
              <Button type="submit" size="sm" disabled={isCreatingFolder} className="shrink-0 whitespace-nowrap">
                {isCreatingFolder ? <Loader2 className="h-4 w-4 animate-spin" /> : "추가"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={isCreatingFolder}
                className="shrink-0 whitespace-nowrap"
                onClick={() => { setCreatingUnder(undefined); setNewFolderName(""); }}
              >취소</Button>
            </form>
          ) : null}

          {/* 영상 목록 (폴더별 그룹 - 중첩 지원) */}
          {videos.length === 0 && folders.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              아직 영상이 없습니다. <Link to="/admin/upload" className="text-primary underline">업로드</Link>{" "}
              또는 <Link to="/admin/videos" className="text-primary underline">등록된 영상</Link>에서 이 수강반으로 지정하세요.
            </p>
          ) : (
            (() => {
              const childrenByParent = new Map<string | null, any[]>();
              folders.forEach((f: any) => {
                const key = (f.parent_folder_id ?? null) as string | null;
                const arr = childrenByParent.get(key) ?? [];
                arr.push(f);
                childrenByParent.set(key, arr);
              });
              const videosByFolder = new Map<string | null, any[]>();
              videos.forEach((v: any) => {
                const key = (v.folder_id ?? null) as string | null;
                const arr = videosByFolder.get(key) ?? [];
                arr.push(v);
                videosByFolder.set(key, arr);
              });
              // 폴더 경로 문자열 (Select 표시용)
              const folderById = new Map<string, any>(folders.map((f: any) => [f.id, f]));
              const pathOf = (fid: string): string => {
                const parts: string[] = [];
                let cur: any = folderById.get(fid);
                let guard = 0;
                while (cur && guard++ < 20) {
                  parts.unshift(cur.name);
                  cur = cur.parent_folder_id ? folderById.get(cur.parent_folder_id) : null;
                }
                return parts.join(" / ");
              };
              // 순환 방지: folder의 조상들
              const ancestorsOf = (fid: string): Set<string> => {
                const out = new Set<string>();
                let cur: any = folderById.get(fid);
                let guard = 0;
                while (cur?.parent_folder_id && guard++ < 20) {
                  out.add(cur.parent_folder_id);
                  cur = folderById.get(cur.parent_folder_id);
                }
                return out;
              };

              const renderVideoList = (items: any[]) => (
                <ul className="divide-y">
                  {items.map((v: any, i: number) => (
                    <li
                      key={v.id}
                      draggable
                      onDragStart={(e) => {
                        setDraggingVideoId(v.id);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", v.id);
                      }}
                      onDragEnd={() => { setDraggingVideoId(null); setDragOverFolder(undefined); }}
                      className={`grid cursor-grab grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 active:cursor-grabbing sm:grid-cols-[auto_auto_minmax(0,1fr)_auto_auto_auto] sm:gap-3 ${
                        draggingVideoId === v.id ? "opacity-50" : ""
                      }`}
                    >
                      <span className="w-5 shrink-0 text-xs text-muted-foreground">{i + 1}</span>
                      <Link
                        to="/admin/video/$id"
                        params={{ id: v.id }}
                        className="block h-12 w-20 shrink-0 overflow-hidden rounded bg-muted sm:h-14 sm:w-24"
                      >
                        {v.thumbnail_url ? (
                          <VideoThumb src={v.thumbnail_url} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                            <Film className="h-4 w-4" />
                          </div>
                        )}
                      </Link>
                      <div className="min-w-0 flex-1">
                        <Link
                          to="/admin/video/$id"
                          params={{ id: v.id }}
                          className="block truncate text-sm font-medium hover:text-primary hover:underline"
                        >
                          {v.title}
                        </Link>
                        <p className="truncate text-xs text-muted-foreground">
                          {v.is_published ? "공개" : "비공개"} · {v.status}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Select
                          value={v.folder_id ?? "__none__"}
                          onValueChange={(val) =>
                            handleAssignVideoToFolder(v.id, val === "__none__" ? null : val)
                          }
                        >
                          <SelectTrigger className="h-8 w-24 text-xs sm:w-40">
                            <SelectValue placeholder="폴더" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">폴더 미지정</SelectItem>
                            {folders.map((f: any) => (
                              <SelectItem key={f.id} value={f.id}>{pathOf(f.id)}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 shrink-0"
                          disabled={i === 0}
                          onClick={async () => {
                            try {
                              await swapVideoOrder({ data: { classId: id, videoId: v.id, direction: "up" } });
                              qc.invalidateQueries({ queryKey: ["admin", "class", id, "videos"] });
                            } catch (e: any) { toast.error(e.message); }
                          }}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 shrink-0"
                          disabled={i === items.length - 1}
                          onClick={async () => {
                            try {
                              await swapVideoOrder({ data: { classId: id, videoId: v.id, direction: "down" } });
                              qc.invalidateQueries({ queryKey: ["admin", "class", id, "videos"] });
                            } catch (e: any) { toast.error(e.message); }
                          }}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              );

              const renderFolder = (f: any, depth: number): React.ReactElement => {
                const childFolders = childrenByParent.get(f.id) ?? [];
                const items = videosByFolder.get(f.id) ?? [];
                const isEditing = editingFolderId === f.id;
                return (
                  <div
                    key={f.id}
                    style={{ marginLeft: depth > 0 ? 16 : 0 }}
                    onDragOver={(e) => {
                      if (!draggingVideoId) return;
                      e.preventDefault();
                      e.stopPropagation();
                      e.dataTransfer.dropEffect = "move";
                      setDragOverFolder(f.id);
                    }}
                    onDragLeave={(e) => {
                      e.stopPropagation();
                      setDragOverFolder((cur) => (cur === f.id ? undefined : cur));
                    }}
                    onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleDropOnFolder(f.id); }}
                    className={`rounded-md border transition-colors ${
                      dragOverFolder === f.id ? "border-primary bg-primary/5" : ""
                    }`}
                  >
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b bg-muted/40 px-3 py-2 text-sm font-medium">
                      {isEditing ? (
                        <>
                          <div className="flex flex-1 items-center gap-2">
                            <Input
                              autoFocus
                              className="h-7 flex-1"
                              value={editingFolderName}
                              onChange={(e) => setEditingFolderName(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") handleRenameFolder(f.id); }}
                            />
                          </div>
                          <div className="flex items-center gap-1">
                            <Button size="sm" onClick={() => handleRenameFolder(f.id)}>저장</Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingFolderId(null)}>취소</Button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex min-w-0 items-center gap-2">
                            <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="truncate">{f.name}</span>
                            <span className="text-xs text-muted-foreground">
                              (폴더 {childFolders.length} · 영상 {items.length})
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 whitespace-nowrap px-2 text-xs"
                              onClick={() => { setCreatingUnder(f.id); setNewFolderName(""); }}
                            >
                              <FolderPlus className="mr-1 h-3.5 w-3.5" /> 하위 폴더 추가
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6"
                              onClick={() => { setEditingFolderId(f.id); setEditingFolderName(f.name); }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6"
                              onClick={() => handleDeleteFolder(f.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                    {creatingUnder === f.id && (
                      <form onSubmit={handleCreateFolder} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 border-b bg-muted/20 px-3 py-2">
                        <Input
                          autoFocus
                          value={newFolderName}
                          onChange={(e) => setNewFolderName(e.target.value)}
                          placeholder={`${f.name} 안에 만들 폴더 이름`}
                          disabled={isCreatingFolder}
                        />
                        <Button type="submit" size="sm" disabled={isCreatingFolder} className="shrink-0 whitespace-nowrap">
                          {isCreatingFolder ? <Loader2 className="h-4 w-4 animate-spin" /> : "추가"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={isCreatingFolder}
                          className="shrink-0 whitespace-nowrap"
                          onClick={() => { setCreatingUnder(undefined); setNewFolderName(""); }}
                        >취소</Button>
                      </form>
                    )}
                    <div className="space-y-2 p-2">
                      {items.length > 0 && renderVideoList(items)}
                      {childFolders.map((cf: any) => renderFolder(cf, depth + 1))}
                      {items.length === 0 && childFolders.length === 0 && (
                        <p className="px-2 py-3 text-xs text-muted-foreground">비어 있습니다.</p>
                      )}
                    </div>
                  </div>
                );
              };

              const rootFolders = childrenByParent.get(null) ?? [];
              const unassignedVideos = videosByFolder.get(null) ?? [];
              // 참조 방지 경고 억제
              void ancestorsOf;
              return (
                <div className="space-y-4">
                  {draggingVideoId && (
                    <p className="text-xs text-muted-foreground">
                      영상을 원하는 폴더 위로 끌어다 놓으면 이동됩니다.
                    </p>
                  )}
                  {rootFolders.map((f: any) => renderFolder(f, 0))}
                  {(unassignedVideos.length > 0 || draggingVideoId) && (
                    <div
                      onDragOver={(e) => {
                        if (!draggingVideoId) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        setDragOverFolder(null);
                      }}
                      onDragLeave={() => setDragOverFolder((cur) => (cur === null ? undefined : cur))}
                      onDrop={(e) => { e.preventDefault(); handleDropOnFolder(null); }}
                      className={`rounded-md border transition-colors ${
                        dragOverFolder === null ? "border-primary bg-primary/5" : ""
                      }`}
                    >
                      <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2 text-sm font-medium">
                        <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">폴더 미지정</span>
                        <span className="text-xs text-muted-foreground">({unassignedVideos.length})</span>
                      </div>
                      {unassignedVideos.length > 0 ? (
                        renderVideoList(unassignedVideos)
                      ) : (
                        <p className="px-3 py-3 text-xs text-muted-foreground">여기에 놓으면 폴더 미지정으로 이동합니다.</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })()
          )}
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="stats">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 shrink-0" /> <span className="truncate">학생별 학습 현황</span>
            </CardTitle>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Select value={statsFilter} onValueChange={(v) => setStatsFilter(v as any)}>
                <SelectTrigger className="h-8 w-full sm:w-40">
                  <SelectValue placeholder="필터" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체</SelectItem>
                  <SelectItem value="completed">완료한 학생</SelectItem>
                  <SelectItem value="incomplete">미완료 학생</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={String(statsPageSize)}
                onValueChange={(v) => setStatsPageSize(Number(v))}
              >
                <SelectTrigger className="h-8 w-full sm:w-32">
                  <SelectValue placeholder="페이지당 인원" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10명씩</SelectItem>
                  <SelectItem value="20">20명씩</SelectItem>
                  <SelectItem value="50">50명씩</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {studentStats.length === 0 ? (
            <p className="text-sm text-muted-foreground">배정된 학생이 없습니다.</p>
          ) : filteredStudentStats.length === 0 ? (
            <p className="text-sm text-muted-foreground">선택한 필터에 해당하는 학생이 없습니다.</p>
          ) : (
            <div>
              <div className="hidden grid-cols-[1fr_80px_100px_150px] gap-2 border-b px-3 pb-2 text-xs text-muted-foreground sm:grid">
                <span>학생</span>
                <span>완료</span>
                <span>평균 시청률</span>
                <span>최근 학습</span>
              </div>
              <Accordion type="multiple" className="w-full">
                {pagedStudentStats.map((s: any) => (
                  <AccordionItem key={s.user_id} value={s.user_id}>
                    <AccordionTrigger className="px-3 hover:no-underline">
                      <div className="grid w-full grid-cols-2 gap-2 pr-2 text-left text-sm sm:grid-cols-[1fr_80px_100px_150px]">
                        <span className="truncate font-medium">
                          {s.name || "-"}{s.phone ? ` (${s.phone})` : ""}
                        </span>
                        <span className="whitespace-nowrap">{s.completed} / {s.video_total}</span>
                        <span className="whitespace-nowrap">{Math.round(s.avg_watched_ratio * 100)}%</span>
                        <span className="whitespace-nowrap text-xs text-muted-foreground">
                          {s.last_activity ? new Date(s.last_activity).toLocaleString("ko-KR") : "-"}
                        </span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <StudentVideoDetail classId={id} userId={s.user_id} />
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
              <div className="mt-3 flex flex-col items-center justify-between gap-2 border-t pt-3 sm:flex-row">
                <span className="text-xs text-muted-foreground">
                  총 {filteredStudentStats.length}명 · {statsPage} / {statsTotalPages} 페이지
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={statsPage <= 1}
                    onClick={() => setStatsPage((p) => Math.max(1, p - 1))}
                  >
                    이전
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={statsPage >= statsTotalPages}
                    onClick={() => setStatsPage((p) => Math.min(statsTotalPages, p + 1))}
                  >
                    다음
                  </Button>
                </div>
              </div>
            </div>

          )}
        </CardContent>

      </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle className="flex min-w-0 items-center gap-2">
                <History className="h-5 w-5 shrink-0" />
                <span className="truncate">배정 이력 ({history.length})</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground">아직 이력이 없습니다.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="whitespace-nowrap py-2 pr-4">일시</th>
                        <th className="whitespace-nowrap py-2 pr-4">학생</th>
                        <th className="whitespace-nowrap py-2 pr-4">연락처</th>
                        <th className="whitespace-nowrap py-2 pr-4">학부모 연락처</th>
                        <th className="whitespace-nowrap py-2 pr-4">동작</th>
                        <th className="whitespace-nowrap py-2 pr-4">처리자</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((h: any) => (
                        <tr key={h.id} className="border-b last:border-0">
                          <td className="whitespace-nowrap py-2 pr-4">
                            {new Date(h.created_at).toLocaleString("ko-KR")}
                          </td>
                          <td className="whitespace-nowrap py-2 pr-4">
                            <span className="inline-flex items-center gap-1.5">
                              {h.student_name || h.student_email || h.user_id.slice(0, 8)}
                              <BranchBadge branch={h.student_branch} />
                            </span>
                          </td>
                          <td className="whitespace-nowrap py-2 pr-4 text-muted-foreground">
                            {h.student_phone || "-"}
                          </td>
                          <td className="whitespace-nowrap py-2 pr-4 text-muted-foreground">
                            {h.student_parent_phone || "-"}
                          </td>
                          <td className="whitespace-nowrap py-2 pr-4">
                            <span
                              className={
                                h.action === "added"
                                  ? "rounded bg-green-500/15 px-2 py-0.5 text-xs text-green-700"
                                  : "rounded bg-red-500/15 px-2 py-0.5 text-xs text-red-700"
                              }
                            >
                              {h.action === "added" ? "배정" : "해제"}
                            </span>
                          </td>
                          <td className="whitespace-nowrap py-2 pr-4 text-muted-foreground">
                            {h.actor_id ? (
                              <span className="inline-flex items-center gap-1.5">
                                {h.actor_role && h.actor_role !== "other" && (
                                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                                    {h.actor_role === "admin" ? "관리자" : "강사"}
                                  </span>
                                )}
                                <span>{h.actor_name || h.actor_id.slice(0, 8)}</span>
                              </span>
                            ) : (
                              "시스템"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings">
          <Card>
            <CardHeader>
              <CardTitle>수강반 설정</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="mb-2 block">활성 기간</Label>
                <p className="mb-3 text-xs text-muted-foreground">
                  이 기간 동안만 학생이 수강반에 접근할 수 있습니다. (관리자/강사는 항상 접근 가능)
                </p>
                <div className="mb-3 flex items-center gap-2">
                  <input
                    id="s_always"
                    type="checkbox"
                    className="h-4 w-4"
                    checked={settingsAlways}
                    onChange={(e) => setSettingsAlways(e.target.checked)}
                  />
                  <Label htmlFor="s_always" className="cursor-pointer">상시 활성 (기간 제한 없음)</Label>
                </div>
                {!settingsAlways && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="s_from" className="text-xs">시작일</Label>
                      <Input id="s_from" type="date" value={settingsFrom} onChange={(e) => setSettingsFrom(e.target.value)} />
                    </div>
                    <div>
                      <Label htmlFor="s_to" className="text-xs">종료일</Label>
                      <Input id="s_to" type="date" value={settingsTo} onChange={(e) => setSettingsTo(e.target.value)} />
                    </div>
                  </div>
                )}
              </div>
              <Button onClick={saveSettings} disabled={savingSettings}>
                {savingSettings ? "저장 중..." : "저장"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

    </div>
  );
}
