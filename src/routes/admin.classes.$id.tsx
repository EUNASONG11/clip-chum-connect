import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
  GraduationCap, FolderPlus, Folder, Pencil, Trash2, Loader2, History,
} from "lucide-react";
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
} from "@/lib/classes.functions";

import { getClassStudentStats } from "@/lib/stats.functions";
import { useAdminRole } from "@/components/AdminRole";
import { VideoThumb } from "@/components/VideoThumb";

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
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState("");

  const refreshVideosAndFolders = () => {
    qc.invalidateQueries({ queryKey: ["admin", "class", id, "videos"] });
    qc.invalidateQueries({ queryKey: ["admin", "class", id, "folders"] });
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim() || isCreatingFolder) return;
    setIsCreatingFolder(true);
    try {
      await createClassFolder({ data: { classId: id, name: newFolderName.trim() } });
      setNewFolderName("");
      setCreatingFolder(false);
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

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<
    { user_id: string; name: string; phone: string; school: string; grade: string }[]
  >([]);
  const [searching, setSearching] = useState(false);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    try {
      const rows = await searchStudentsByNameOrPhone({ data: { query: query.trim() } });
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
        <div className="mt-2 flex min-w-0 items-baseline gap-2">
          <h1 className="truncate text-2xl font-bold">{cls?.name ?? "..."}</h1>
          {cls?.description && (
            <p className="min-w-0 truncate text-sm text-muted-foreground">{cls.description}</p>
          )}
        </div>
      </div>

      <Tabs defaultValue="students" className="w-full min-w-0">
        <TabsList className={isAdmin ? "grid w-full grid-cols-5" : "grid w-full grid-cols-4"}>
          <TabsTrigger value="students" className="whitespace-nowrap px-2 text-xs sm:text-sm">학생 배정</TabsTrigger>
          {isAdmin && <TabsTrigger value="instructors" className="whitespace-nowrap px-2 text-xs sm:text-sm">강사 배정</TabsTrigger>}
          <TabsTrigger value="videos" className="whitespace-nowrap px-2 text-xs sm:text-sm">영상</TabsTrigger>
          <TabsTrigger value="stats" className="whitespace-nowrap px-2 text-xs sm:text-sm">학습 현황</TabsTrigger>
          <TabsTrigger value="history" className="whitespace-nowrap px-2 text-xs sm:text-sm">배정 이력</TabsTrigger>
        </TabsList>

        <TabsContent value="students">
      <Card>
        <CardHeader>
            <CardTitle className="flex min-w-0 items-center gap-2">
              <UserPlus className="h-5 w-5 shrink-0" /> <span className="truncate">학생 배정 ({students.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={search} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
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
          </form>

          {results.length > 0 && (
            <div className="rounded-md border">
              <ul className="divide-y">
                {results.map((r) => {
                  const already = students.some((s: any) => s.user_id === r.user_id);
                  return (
                    <li key={r.user_id} className="flex items-center gap-2 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{r.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {r.phone}
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
                    <p className="truncate text-sm font-medium">{s.name || s.email}</p>
                    {s.phone && (
                      <p className="truncate text-xs text-muted-foreground">{s.phone}</p>
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

      {isAdmin && (
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
          {!creatingFolder && (
            <Button size="sm" variant="outline" onClick={() => setCreatingFolder(true)} className="whitespace-nowrap">
              <FolderPlus className="mr-1 h-4 w-4 shrink-0" /> 폴더 추가
            </Button>
          )}
          {creatingFolder && (
            <form onSubmit={handleCreateFolder} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
              <Input
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="폴더 이름 (예: 1주차)"
                disabled={isCreatingFolder}
              />
              <Button type="submit" size="sm" disabled={isCreatingFolder} className="shrink-0 whitespace-nowrap">
                {isCreatingFolder ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "추가"
                )}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={isCreatingFolder}
                className="shrink-0 whitespace-nowrap"
                onClick={() => { setCreatingFolder(false); setNewFolderName(""); }}
              >취소</Button>
            </form>
          )}

          {/* 영상 목록 (폴더별 그룹) */}
          {videos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              아직 영상이 없습니다. <Link to="/admin/upload" className="text-primary underline">업로드</Link>{" "}
              또는 <Link to="/admin/videos" className="text-primary underline">등록된 영상</Link>에서 이 수강반으로 지정하세요.
            </p>
          ) : (
            <div className="space-y-4">
              {[
                ...folders.map((f: any) => ({ id: f.id, name: f.name })),
                { id: null as string | null, name: "폴더 미지정" },
              ].map((group) => {
                const items = videos.filter((v: any) => (v.folder_id ?? null) === group.id);
                if (items.length === 0 && group.id === null) return null;
                return (
                  <div key={group.id ?? "none"} className="rounded-md border">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b bg-muted/40 px-3 py-2 text-sm font-medium">
                      {group.id && editingFolderId === group.id ? (
                        <>
                          <div className="flex flex-1 items-center gap-2">
                            <Input
                              autoFocus
                              className="h-7 flex-1"
                              value={editingFolderName}
                              onChange={(e) => setEditingFolderName(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") handleRenameFolder(group.id!); }}
                            />
                          </div>
                          <div className="flex items-center gap-1">
                            <Button size="sm" onClick={() => handleRenameFolder(group.id!)}>저장</Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingFolderId(null)}>취소</Button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex min-w-0 items-center gap-2">
                            <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="truncate">{group.name}</span>
                            <span className="text-xs text-muted-foreground">({items.length})</span>
                          </div>
                          {group.id && (
                            <div className="flex items-center gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6"
                                onClick={() => { setEditingFolderId(group.id!); setEditingFolderName(group.name); }}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6"
                                onClick={() => handleDeleteFolder(group.id!)}
                              >
                                <Trash2 className="h-3.5 w-3.5 text-destructive" />
                              </Button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    {items.length === 0 ? (
                      <p className="px-3 py-3 text-xs text-muted-foreground">이 폴더에 영상이 없습니다.</p>
                    ) : (
                      <ul className="divide-y">
                        {items.map((v: any, i: number) => (
                          <li key={v.id} className="grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 sm:grid-cols-[auto_auto_minmax(0,1fr)_auto_auto_auto] sm:gap-3">
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
                              <SelectTrigger className="h-8 w-24 text-xs sm:w-36">
                                <SelectValue placeholder="폴더" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">폴더 미지정</SelectItem>
                                {folders.map((f: any) => (
                                  <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
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
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="stats">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 shrink-0" /> <span className="truncate">학생별 학습 현황</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {studentStats.length === 0 ? (
            <p className="text-sm text-muted-foreground">배정된 학생이 없습니다.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-4 whitespace-nowrap">학생</th>
                    <th className="py-2 pr-4 whitespace-nowrap">완료</th>
                    <th className="py-2 pr-4 whitespace-nowrap">평균 시청률</th>
                    <th className="py-2 pr-4 whitespace-nowrap">최근 학습</th>
                  </tr>
                </thead>
                <tbody>
                  {studentStats.map((s: any) => (
                    <tr key={s.user_id} className="border-t">
                      <td className="py-2 pr-4 whitespace-nowrap">{s.name || "-"}{s.phone ? ` (${s.phone})` : ""}</td>
                      <td className="py-2 pr-4 whitespace-nowrap">
                        {s.completed} / {s.video_total}
                      </td>
                      <td className="py-2 pr-4 whitespace-nowrap">{Math.round(s.avg_watched_ratio * 100)}%</td>
                      <td className="py-2 pr-4 whitespace-nowrap text-xs text-muted-foreground">
                        {s.last_activity ? new Date(s.last_activity).toLocaleString("ko-KR") : "-"}
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
                            {h.student_name || h.student_email || h.user_id.slice(0, 8)}
                          </td>
                          <td className="whitespace-nowrap py-2 pr-4 text-muted-foreground">
                            {h.student_phone || "-"}
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
                            {h.actor_name || (h.actor_id ? h.actor_id.slice(0, 8) : "시스템")}
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
      </Tabs>
    </div>
  );
}
