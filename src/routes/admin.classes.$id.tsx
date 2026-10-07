import { isValidNaesinClassName } from "@/lib/naming";
import { NaesinClassNamePicker } from "@/components/admin/NamingPickers";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  ArrowLeft, UserPlus, X, Film, BarChart3, Search, ArrowUp, ArrowDown,
  GraduationCap, FolderPlus, Folder, Pencil, Trash2, Loader2, History, MessageSquare, RefreshCw,
  ChevronDown, ChevronUp, EyeOff, Eye, Users,
} from "lucide-react";
import { SendMessageDialog } from "@/components/admin/SendMessageDialog";
import { SmsLogPanel } from "@/components/admin/SmsLogPanel";
import { ExternalAssignmentPanel } from "@/components/admin/ExternalAssignmentPanel";

import { ClearableSearchInput } from "@/components/admin/ClearableSearchInput";
import { CohortMultiSelect } from "@/components/admin/CohortMultiSelect";
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
  listStudentFilterOptions,
  listClassCategories,
} from "@/lib/classes.functions";
import { isSearchableStudentQuery, STUDENT_SEARCH_HINT } from "@/lib/student-search";


const BRANCH_OPTIONS = ["상동", "청라", "송도"] as const;

import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { getClassStudentStats, getStudentVideoDetail, getVideoStudentStats, listStudentSeekEvents, setStudentVideoProgress, setStudentProgressStart } from "@/lib/stats.functions";
import { setVideoExclusion } from "@/lib/video-exclusions.functions";

function fmtDur(sec: number) {
  const s = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m >= 60) return `${Math.floor(m / 60)}시간 ${m % 60}분`;
  return m > 0 ? `${m}분 ${r}초` : `${r}초`;
}

function SeekEventList({ classId, userId, videoId }: { classId: string; userId: string; videoId: string }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ["admin", "class", classId, "seek-events", userId, videoId],
    queryFn: () => listStudentSeekEvents({ data: { classId, userId, videoId } }),
  });
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> 불러오는 중...
      </div>
    );
  }
  if (data.length === 0) {
    return <p className="px-3 py-2 text-xs text-muted-foreground">기록된 건너뛰기 시도가 없습니다.</p>;
  }
  return (
    <ul className="space-y-1 px-3 py-2">
      {data.map((e: any) => (
        <li key={e.id} className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="tabular-nums">{new Date(e.created_at).toLocaleString("ko-KR")}</span>
          <span className="tabular-nums">
            {fmtDur(e.from_seconds)} → {fmtDur(e.to_seconds)}
          </span>
          <span className={e.blocked ? "text-destructive" : "text-muted-foreground"}>
            {e.blocked ? "차단됨" : "허용"}
          </span>
        </li>
      ))}
    </ul>
  );
}

// 특정 영상의 학생별 시청 현황 다이얼로그 (학습현황의 역방향)
function VideoStudentStatsDialog({
  classId,
  video,
  onClose,
}: {
  classId: string;
  video: { id: string; title: string } | null;
  onClose: () => void;
}) {
  const { data = [], isLoading } = useQuery({
    queryKey: ["admin", "class", classId, "video-student-stats", video?.id],
    queryFn: () => getVideoStudentStats({ data: { classId, videoId: video!.id } }),
    enabled: !!video,
  });
  const [nameQuery, setNameQuery] = useState("");
  const q = nameQuery.replace(/\s+/g, "").toLowerCase();
  const filtered = q
    ? data.filter((s: any) => (s.name || "").replace(/\s+/g, "").toLowerCase().includes(q))
    : data;
  const completed = filtered.filter((s: any) => s.is_completed).length;
  return (
    <Dialog open={!!video} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-base">
            학생별 시청 현황 — <span className="font-normal">{video?.title}</span>
          </DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중...
          </div>
        ) : data.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">배정된 학생이 없습니다.</p>
        ) : (
          <>
            <ClearableSearchInput
              value={nameQuery}
              onChange={setNameQuery}
              placeholder="학생 이름 검색"
              size="sm"
              className="mt-2"
            />
            <p className="mt-2 text-xs text-muted-foreground">
              {q ? `검색 결과 ${filtered.length}명 · ` : `전체 ${data.length}명 · `}완료 {completed}명 · 미완료 {filtered.length - completed}명
            </p>
            {filtered.length === 0 ? (
              <p className="py-6 text-sm text-muted-foreground">검색 결과가 없습니다.</p>
            ) : (() => {
              // 교육원별 그룹화 (미지정은 맨 뒤)
              const order = ["상동", "청라", "송도"];
              const groups = new Map<string, any[]>();
              for (const s of filtered) {
                const key = s.branch || "미지정";
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key)!.push(s);
              }
              const keys = [...groups.keys()].sort((a, b) => {
                const ia = order.indexOf(a);
                const ib = order.indexOf(b);
                if (ia === -1 && ib === -1) return a.localeCompare(b, "ko");
                if (ia === -1) return 1;
                if (ib === -1) return -1;
                return ia - ib;
              });
              return (
                <div className="mt-2 space-y-4">
                  {keys.map((key) => {
                    const rows = groups.get(key)!;
                    const done = rows.filter((s: any) => s.is_completed).length;
                    return (
                      <section key={key}>
                        <p className="mb-1 flex items-center gap-2 text-xs font-medium">
                          <BranchBadge branch={key} />
                          <span className="text-muted-foreground">
                            {rows.length}명 · 완료 {done}명 · 미완료 {rows.length - done}명
                          </span>
                        </p>
                        <ul className="divide-y rounded-md border">
                          {rows.map((s: any) => (
                            <li key={s.user_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                              <span className="min-w-0 flex-1 truncate text-sm">
                                {s.name}
                                <span className="ml-2 text-xs text-muted-foreground">
                                  {s.school}
                                </span>
                              </span>
                              {s.is_hidden && (
                                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                  숨김
                                </span>
                              )}
                              <div className="hidden h-2 w-28 overflow-hidden rounded-full bg-muted sm:block">
                                <div
                                  className={`h-full ${s.is_completed ? "bg-green-500" : "bg-primary"}`}
                                  style={{ width: `${Math.min(100, Math.ceil(s.watched_ratio * 100))}%` }}
                                />
                              </div>
                              <span className="w-12 shrink-0 text-right text-sm tabular-nums">
                                {s.is_completed ? 100 : Math.min(99, Math.ceil(s.watched_ratio * 100))}%
                              </span>
                              <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                                {fmtDur(s.watched_seconds)}
                              </span>
                              <span className={`w-14 shrink-0 text-right text-xs ${s.is_completed ? "text-green-600" : "text-muted-foreground"}`}>
                                {s.is_completed ? "완료" : s.watched_ratio > 0 ? "시청 중" : "미시청"}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </section>
                    );
                  })}
                </div>
              );
            })()}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StudentVideoDetail({
  classId,
  userId,
  canEdit = false,
}: {
  classId: string;
  userId: string;
  canEdit?: boolean;
}) {
  const [openVideoId, setOpenVideoId] = useState<string | null>(null);
  const [openWatchId, setOpenWatchId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const qcDetail = useQueryClient();

  const saveRatio = useMutation({
    mutationFn: (p: { videoId: string; ratio: number }) =>
      setStudentVideoProgress({ data: { classId, userId, videoId: p.videoId, ratio: p.ratio } }),
    onSuccess: () => {
      toast.success("시청률을 수정했습니다.");
      setEditId(null);
      qcDetail.invalidateQueries({ queryKey: ["admin", "class", classId, "student-video-detail", userId] });
      qcDetail.invalidateQueries({ queryKey: ["admin", "class", classId, "student-stats"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "수정에 실패했습니다."),
  });

  const toggleHidden = useMutation({
    mutationFn: (p: { videoId: string; hidden: boolean }) =>
      setVideoExclusion({ data: { videoId: p.videoId, userId, hidden: p.hidden } }),
    onSuccess: (_r, p) => {
      toast.success(p.hidden ? "이 학생에게 영상을 숨겼습니다." : "다시 보이도록 했습니다.");
      qcDetail.invalidateQueries({ queryKey: ["admin", "class", classId, "student-video-detail", userId] });
      qcDetail.invalidateQueries({ queryKey: ["admin", "class", classId, "student-stats"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "처리에 실패했습니다."),
  });

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
  const groups = (() => {
    const map = new Map<string, { key: string; name: string | null; sort: number; required: boolean | null; items: any[] }>();
    for (const v of data as any[]) {
      const key = (v.folder_id ?? "__none__") as string;
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          name: v.folder_name ?? null,
          sort: v.folder_id ? Number(v.folder_sort ?? 9999) : 99999,
          required: v.folder_is_required ?? null,
          items: [],
        };
        map.set(key, g);
      }
      g.items.push(v);
    }
    return [...map.values()].sort((a, b) => a.sort - b.sort || (a.name ?? "").localeCompare(b.name ?? ""));
  })();

  const renderVideoRow = (v: any) => (
        <div key={v.video_id} className={`rounded-md bg-background ${v.is_hidden ? "opacity-55" : ""}`}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
            <Film className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm">{v.title}</span>
            {v.is_hidden && (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                숨김
              </span>
            )}
            <div className="hidden h-2 w-28 overflow-hidden rounded-full bg-muted sm:block">
              <div
                className={`h-full ${v.is_completed ? "bg-green-500" : "bg-primary"}`}
                style={{ width: `${Math.min(100, Math.ceil(v.watched_ratio * 100))}%` }}
              />
            </div>
            {canEdit && editId === v.video_id ? (
              <span className="flex shrink-0 items-center gap-1">
                <Input
                  autoFocus
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const n = Number(editValue);
                      if (!Number.isFinite(n) || n < 0 || n > 100) {
                        toast.error("0~100 사이 숫자를 입력하세요.");
                        return;
                      }
                      saveRatio.mutate({ videoId: v.video_id, ratio: n / 100 });
                    }
                    if (e.key === "Escape") setEditId(null);
                  }}
                  className="h-7 w-16 text-right text-xs tabular-nums"
                  inputMode="decimal"
                />
                <span className="text-xs text-muted-foreground">%</span>
                <Button
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={saveRatio.isPending}
                  onClick={() => {
                    const n = Number(editValue);
                    if (!Number.isFinite(n) || n < 0 || n > 100) {
                      toast.error("0~100 사이 숫자를 입력하세요.");
                      return;
                    }
                    saveRatio.mutate({ videoId: v.video_id, ratio: n / 100 });
                  }}
                >
                  저장
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => setEditId(null)}
                >
                  취소
                </Button>
              </span>
            ) : (
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => {
                  setEditId(v.video_id);
                  setEditValue(
                    String(v.is_completed ? 100 : Math.min(99, Math.ceil(v.watched_ratio * 100))),
                  );
                }}
                title={canEdit ? "시청률 수정" : undefined}
                className={`w-12 shrink-0 rounded text-right text-sm tabular-nums ${
                  canEdit ? "hover:bg-muted" : ""
                }`}
              >
                {v.is_completed ? 100 : Math.min(99, Math.ceil(v.watched_ratio * 100))}%
              </button>
            )}

            <button
              type="button"
              onClick={() => setOpenWatchId((cur) => (cur === v.video_id ? null : v.video_id))}
              className={`w-24 shrink-0 rounded px-1 py-0.5 text-right text-xs tabular-nums ${
                openWatchId === v.video_id
                  ? "bg-primary/20 text-primary hover:bg-primary/30"
                  : "bg-primary/10 text-primary hover:bg-primary/20"
              }`}
            >
              시청 {fmtDur(v.watched_seconds)}
            </button>

            <button
              type="button"
              onClick={() =>
                setOpenVideoId((cur) => (cur === v.video_id ? null : v.video_id))
              }
              className={`shrink-0 rounded px-2 py-0.5 text-xs ${
                v.seek_attempts > 0
                  ? "bg-destructive/10 text-destructive hover:bg-destructive/20"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              건너뛰기 {v.seek_attempts}회
            </button>
            <span className={`w-16 shrink-0 text-right text-xs ${v.is_completed ? "text-green-600" : "text-muted-foreground"}`}>
              {v.is_completed ? "완료" : v.watched_ratio > 0 ? "시청 중" : "미시청"}
            </span>
            {canEdit && (
              <button
                type="button"
                disabled={toggleHidden.isPending}
                onClick={() => toggleHidden.mutate({ videoId: v.video_id, hidden: !v.is_hidden })}
                title={v.is_hidden ? "이 학생에게 다시 보이기" : "이 학생에게 숨기기"}
                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {v.is_hidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </button>
            )}
            <span className="hidden w-36 shrink-0 text-right text-xs text-muted-foreground md:block">
              {v.updated_at ? new Date(v.updated_at).toLocaleString("ko-KR") : "-"}
            </span>
          </div>
          {openWatchId === v.video_id && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 border-t px-3 py-2 text-xs text-muted-foreground sm:grid-cols-4">
              <span>
                영상 길이 <b className="text-foreground tabular-nums">{v.duration ? fmtDur(v.duration) : "-"}</b>
              </span>
              <span>
                실제 시청 <b className="text-foreground tabular-nums">{fmtDur(v.watched_seconds)}</b>
                {v.duration ? ` (${Math.round((v.watched_seconds / v.duration) * 100)}%)` : ""}
              </span>
              <span>
                도달 지점 <b className="text-foreground tabular-nums">{fmtDur(v.max_seconds)}</b>
                {v.duration ? ` / ${fmtDur(v.duration)}` : ""}
              </span>
              <span>
                완료 시각{" "}
                <b className="text-foreground">
                  {v.completed_at ? new Date(v.completed_at).toLocaleString("ko-KR") : "-"}
                </b>
              </span>
            </div>
          )}

          {openVideoId === v.video_id && (
            <div className="border-t">
              <SeekEventList classId={classId} userId={userId} videoId={v.video_id} />
            </div>
          )}
        </div>
  );

  return (
    <Accordion
      type="multiple"
      defaultValue={groups.map((g) => g.key)}
      className="flex flex-col gap-2 rounded-lg bg-muted/40 p-3"
    >
      {groups.map((g) => (
        <AccordionItem key={g.key} value={g.key} className="rounded-md border bg-background px-3">
          <AccordionTrigger className="py-2 hover:no-underline">
            <span className="flex items-center gap-2">
              <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="text-xs font-semibold text-muted-foreground">
                {g.name ?? "폴더 미지정"}
              </span>
              {g.required === false && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  선택 시청
                </span>
              )}
              <span className="text-[11px] text-muted-foreground">({g.items.length})</span>
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="flex flex-col gap-2 pb-1">{g.items.map(renderVideoRow)}</div>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}


import { useAdminRole } from "@/components/AdminRole";
import { VideoThumb } from "@/components/VideoThumb";
import { prefetchSignedThumbUrls, extractStoragePath } from "@/lib/signed-url-cache";
import { CANONICAL_BRANCHES, canonicalBranch, matchesBranch } from "@/lib/branch";
import { BranchBadge } from "@/components/BranchBadge";

export const Route = createFileRoute("/admin/classes/$id")({
  component: ClassDetailPage,
});

function ClassDetailPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const { isAdmin, isInstructor, isBranchAdmin } = useAdminRole();
  const { data: cls } = useQuery({
    queryKey: ["admin", "class", id],
    queryFn: () => getClass({ data: { id } }),
  });
  // 쓰기 권한: 관리자 / 생성자 / 이 수강반에 배정된 강사만 true
  const canWrite = !cls || (cls as any).can_write !== false;
  const { data: students = [] } = useQuery({
    queryKey: ["admin", "class", id, "students"],
    queryFn: () => listClassStudents({ data: { classId: id } }),
  });
  const { data: videos = [] } = useQuery({
    queryKey: ["admin", "class", id, "videos"],
    queryFn: () => listClassVideos({ data: { classId: id } }),
  });
  // 썸네일 서명 주소를 한 번에 묶어 미리 발급받아 표시 속도를 높인다.
  useEffect(() => {
    const paths = (videos as any[])
      .map((v) => extractStoragePath("video-thumbnails", v.thumbnail_url ?? ""))
      .filter((p): p is string => !!p);
    if (paths.length > 0) prefetchSignedThumbUrls("video-thumbnails", paths);
  }, [videos]);
  const [statsFrom, setStatsFrom] = useState("");
  const [statsTo, setStatsTo] = useState("");
  const { data: studentStats = [], isFetching: statsFetching, refetch: refetchStats } = useQuery({
    queryKey: ["admin", "class", id, "student-stats", statsFrom, statsTo],
    queryFn: () =>
      getClassStudentStats({
        data: {
          classId: id,
          ...(statsFrom ? { from: statsFrom } : {}),
          ...(statsTo ? { to: statsTo } : {}),
        },
      }),
  });

  const { data: folders = [] } = useQuery({
    queryKey: ["admin", "class", id, "folders"],
    queryFn: () => listClassFolders({ data: { classId: id } }),
  });
  // 배정 이력: 서버 페이지네이션/검색 (아래 상태 선언 이후 쿼리 실행)


  const [newFolderName, setNewFolderName] = useState("");
  const [creatingUnder, setCreatingUnder] = useState<string | null | undefined>(undefined);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState("");
  const [settingsName, setSettingsName] = useState("");
  const [settingsDesc, setSettingsDesc] = useState("");
  const [settingsFrom, setSettingsFrom] = useState("");
  const [settingsTo, setSettingsTo] = useState("");
  const [settingsAlways, setSettingsAlways] = useState(false);
  const [settingsCategory, setSettingsCategory] = useState("__none__");
  const [settingsBranch, setSettingsBranch] = useState("__all_branches__");
  const [settingsClassType, setSettingsClassType] = useState("__none__");
  const [savingSettings, setSavingSettings] = useState(false);
  const [messageDialogOpen, setMessageDialogOpen] = useState(false);
  const [statsFilter, setStatsFilter] = useState<"all" | "completed" | "incomplete">("all");
  const [statsSort, setStatsSort] = useState<"name" | "completed" | "ratio" | "recent">("name");
  const [historySearch, setHistorySearch] = useState("");
  const [historySearchDebounced, setHistorySearchDebounced] = useState("");
  const [historyPageSize, setHistoryPageSize] = useState(20);
  const [historyPage, setHistoryPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => setHistorySearchDebounced(historySearch.trim()), 300);
    return () => clearTimeout(t);
  }, [historySearch]);
  useEffect(() => {
    setHistoryPage(1);
  }, [historySearchDebounced, historyPageSize]);
  const { data: historyData } = useQuery({
    queryKey: ["admin", "class", id, "history", historyPage, historyPageSize, historySearchDebounced],
    queryFn: () =>
      listClassEnrollmentHistory({
        data: {
          classId: id,
          page: historyPage,
          pageSize: historyPageSize,
          search: historySearchDebounced,
        },
      }),
    placeholderData: (prev) => prev,
  });
  const pagedHistory = historyData?.rows ?? [];
  const historyTotal = historyData?.total ?? 0;
  const historyTotalPages = Math.max(1, Math.ceil(historyTotal / historyPageSize));


  const { data: categories = [] } = useQuery({
    queryKey: ["admin", "class-categories"],
    queryFn: () => listClassCategories(),
    staleTime: 60_000,
  });

  const clsAny: any = cls;
  useEffect(() => {
    if (clsAny) {
      const always = !clsAny.active_from && !clsAny.active_to;
      setSettingsAlways(always);
      setSettingsFrom(clsAny.active_from ?? "");
      setSettingsTo(clsAny.active_to ?? "");
      setSettingsCategory(clsAny.category_id ?? "__none__");
      setSettingsBranch(clsAny.branch ?? "__all_branches__");
      setSettingsClassType(clsAny.class_type ?? "정규");
      setSettingsName(clsAny.name ?? "");
      setSettingsDesc(clsAny.description ?? "");
    }
  }, [
    clsAny?.active_from,
    clsAny?.active_to,
    clsAny?.category_id,
    clsAny?.branch,
    clsAny?.class_type,
    clsAny?.name,
    clsAny?.description,
  ]);

  const isSettingsDirty = useMemo(() => {
    if (!clsAny) return false;
    const originalAlways = !clsAny.active_from && !clsAny.active_to;
    if (settingsAlways !== originalAlways) return true;
    if (settingsName !== (clsAny.name ?? "")) return true;
    if (settingsDesc !== (clsAny.description ?? "")) return true;
    if (settingsCategory !== (clsAny.category_id ?? "__none__")) return true;
    if (settingsBranch !== (clsAny.branch ?? "__all_branches__")) return true;
    if (settingsClassType !== (clsAny.class_type ?? "정규")) return true;
    if (!settingsAlways) {
      if (settingsFrom !== (clsAny.active_from ?? "")) return true;
      if (settingsTo !== (clsAny.active_to ?? "")) return true;
    }
    return false;
  }, [
    clsAny,
    settingsAlways,
    settingsName,
    settingsDesc,
    settingsCategory,
    settingsBranch,
    settingsClassType,
    settingsFrom,
    settingsTo,
  ]);

  const saveSettings = async () => {
    if (!settingsName.trim()) return toast.error("수강반 이름을 입력하세요.");
    if (!settingsAlways) {
      if (!settingsFrom || !settingsTo) return toast.error("시작일과 종료일을 모두 입력하거나 상시 활성을 체크하세요.");
      if (settingsFrom > settingsTo) return toast.error("종료일은 시작일보다 이후여야 합니다.");
    }
    setSavingSettings(true);
    try {
      await updateClass({
        data: {
          id,
          name: settingsName.trim(),
          description: settingsDesc.trim() || null,
          active_from: settingsAlways ? null : settingsFrom,
          active_to: settingsAlways ? null : settingsTo,
          category_id: settingsCategory === "__none__" ? null : settingsCategory,
          branch: settingsBranch === "__all_branches__" ? null : settingsBranch,
          class_type: settingsClassType as "정규" | "내신",
        },
      });
      toast.success("저장되었습니다.");
      qc.invalidateQueries({ queryKey: ["admin", "class", id] });
      qc.invalidateQueries({ queryKey: ["admin", "classes"] });
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

  const handleToggleFolderRequired = async (folderId: string, next: boolean) => {
    try {
      await updateClassFolder({ data: { id: folderId, isRequired: next } });
      refreshVideosAndFolders();
      toast.success(next ? "필수 시청 폴더로 변경했습니다." : "선택 시청 폴더로 변경했습니다.");
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
    const key = ["admin", "class", id, "videos"];
    const prev = qc.getQueryData<any[]>(key);
    // 낙관적 업데이트: 서버 응답 전에 화면에 즉시 반영
    qc.setQueryData<any[]>(key, (old) =>
      (old ?? []).map((v) => (v.id === videoId ? { ...v, folder_id: folderId } : v)),
    );
    try {
      await setVideoFolder({ data: { videoId, folderId } });
      await Promise.all([
        qc.refetchQueries({ queryKey: key, type: "active" }),
        qc.refetchQueries({ queryKey: ["admin", "class", id, "folders"], type: "active" }),
      ]);
    } catch (err: any) {
      if (prev) qc.setQueryData(key, prev);
      toast.error(err.message);
    }
  };


  // 영상 드래그 앤 드롭으로 폴더 이동
  const [draggingVideoId, setDraggingVideoId] = useState<string | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null | undefined>(undefined);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const findFolderFromTouch = (clientX: number, clientY: number): string | null | undefined => {
    const el = document.elementFromPoint(clientX, clientY);
    if (!el) return undefined;
    const folderEl = el.closest<HTMLElement>("[data-folder-id]");
    if (folderEl) return folderEl.dataset.folderId ?? undefined;
    if (el.closest("[data-unassigned-zone]")) return null;
    return undefined;
  };

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
  const [searchSchool, setSearchSchool] = useState<string>("__all__");
  const [searchCohorts, setSearchCohorts] = useState<string[]>([]);
  const [listBranch, setListBranch] = useState<string>("__all__");
  const [assignedQuery, setAssignedQuery] = useState("");
  const [statsVideo, setStatsVideo] = useState<{ id: string; title: string } | null>(null);

  const [results, setResults] = useState<
      { user_id: string; name: string; phone: string; parent_phone: string; school: string; grade: string; branch: string; cohort?: string | null }[]
  >([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [startSel, setStartSel] = useState<Set<string>>(new Set());
  const [startVideoId, setStartVideoId] = useState<string>("");
  const [startSaving, setStartSaving] = useState(false);
  const applyProgressStart = async (videoId: string | null) => {
    if (startSel.size === 0) return;
    setStartSaving(true);
    try {
      await setStudentProgressStart({ data: { classId: id, userIds: [...startSel], videoId } });
      toast.success(videoId ? `${startSel.size}명의 학습 현황 시작 영상을 설정했습니다.` : `${startSel.size}명을 배정 시점 기준으로 되돌렸습니다.`);
      setStartSel(new Set());
      qc.invalidateQueries({ queryKey: ["admin", "class", id] });
      qc.invalidateQueries();
    } catch (e: any) {
      toast.error(e?.message ?? "설정에 실패했습니다.");
    } finally {
      setStartSaving(false);
    }
  };
  const [searching, setSearching] = useState(false);
  const { data: branchList = [] } = useQuery({
    queryKey: ["student-branches"],
    queryFn: () => listStudentBranches(),
    staleTime: 5 * 60 * 1000,
  });
  const { data: filterOptions = { schools: [], schoolsByBranch: {}, cohorts: [], hasNoCohort: false } } = useQuery({
    queryKey: ["student-filter-options-v2"],
    queryFn: () => listStudentFilterOptions(),
    staleTime: 5 * 60 * 1000,
  });
  const schoolOptions =
    searchBranch !== "__all__"
      ? (filterOptions.schoolsByBranch?.[searchBranch] ?? [])
      : (filterOptions.schools ?? []);

  const hasSearchFilter =
    searchBranch !== "__all__" || searchSchool !== "__all__" || searchCohorts.length > 0;

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    // 검색어가 없어도 교육원/학교/기수 필터가 선택되어 있으면 해당 조건 전체 목록 조회
    if (!isSearchableStudentQuery(query) && !hasSearchFilter) {
      toast.info(STUDENT_SEARCH_HINT);
      return;
    }
    setSearching(true);

    try {
      const rows = await searchStudentsByNameOrPhone({
        data: {
          query: query.trim(),
          ...(searchBranch !== "__all__" ? { branch: searchBranch } : {}),
          ...(searchSchool !== "__all__" ? { school: searchSchool } : {}),
          ...(searchCohorts.length > 0 ? { cohorts: searchCohorts } : {}),
        },
      });
      setResults(rows);
      setSelectedIds(new Set());
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
      setSelectedIds((prev) => {
        if (!prev.has(userId)) return prev;
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
      setQuery("");
      toast.success("배정되었습니다.");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const [bulkAssigning, setBulkAssigning] = useState(false);
  const assignAll = async (targets: { user_id: string; name: string }[]) => {
    if (targets.length === 0) return;
    setBulkAssigning(true);
    let ok = 0;
    const failed: string[] = [];
    for (const t of targets) {
      try {
        await assignStudent({ data: { classId: id, userId: t.user_id } });
        ok += 1;
      } catch {
        failed.push(t.name);
      }
    }
    qc.invalidateQueries({ queryKey: ["admin", "class", id, "students"] });
    qc.invalidateQueries({ queryKey: ["admin", "class", id, "history"] });
    const assignedIds = new Set(targets.map((t) => t.user_id));
    setResults((r) => r.filter((s) => !assignedIds.has(s.user_id) || failed.length > 0));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      assignedIds.forEach((id) => next.delete(id));
      return next;
    });
    setBulkAssigning(false);
    if (ok > 0) {
      setQuery("");
      toast.success(`${ok}명을 배정했습니다.`);
    }
    if (failed.length > 0) toast.error(`배정 실패: ${failed.join(", ")}`);
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
  const [bulkAssigningI, setBulkAssigningI] = useState(false);
  const assignAllI = async (targets: { user_id: string; name: string }[]) => {
    if (targets.length === 0) return;
    setBulkAssigningI(true);
    let ok = 0;
    const failed: string[] = [];
    for (const t of targets) {
      try {
        await assignInstructor({ data: { classId: id, userId: t.user_id } });
        ok += 1;
      } catch {
        failed.push(t.name);
      }
    }
    qc.invalidateQueries({ queryKey: ["admin", "class", id, "instructors"] });
    const assignedIds = new Set(targets.map((t) => t.user_id));
    setIResults((r) => r.filter((s) => !assignedIds.has(s.user_id) || failed.length > 0));
    setBulkAssigningI(false);
    if (ok > 0) {
      setIq("");
      toast.success(`강사 ${ok}명을 배정했습니다.`);
    }
    if (failed.length > 0) toast.error(`배정 실패: ${failed.join(", ")}`);
  };
  const [statsBranchFilter, setStatsBranchFilter] = useState<string>("all");
  const statsBranchOptions = useMemo(() => {
    const set = new Set<string>();
    (studentStats as any[]).forEach((s) => {
      const b = canonicalBranch(s.branch);
      if (b) set.add(b);
    });
    return CANONICAL_BRANCHES.filter((b) => set.has(b)) as string[];
  }, [studentStats]);
  // 강사로 로그인한 경우 학습 현황 교육원 필터를 본인 교육원으로 최초 1회만 자동 선택 (이후 수동 변경 유지)
  const branchAutoAppliedRef = useRef(false);
  useEffect(() => {
    if (branchAutoAppliedRef.current) return;
    if (isAdmin) return;
    if (!isInstructor) return;
    const myBranch = (studentStats as any[])[0]?.my_branch;
    if (!myBranch) return;
    if (statsBranchOptions.includes(myBranch)) {
      branchAutoAppliedRef.current = true;
      setStatsBranchFilter(myBranch);
    }
  }, [isAdmin, isInstructor, studentStats, statsBranchOptions]);
  const filteredStudentStats = useMemo(() => {
    const filtered = (studentStats as any[]).filter((s) => {
      const isCompleted = s.video_total > 0 && s.completed === s.video_total;
      const okStatus =
        statsFilter === "all" ? true : statsFilter === "completed" ? isCompleted : !isCompleted;
      const okBranch =
        statsBranchFilter === "all"
          ? true
          : statsBranchFilter === "none"
            ? !(s.branch ?? "").trim()
            : matchesBranch(statsBranchFilter, s.branch);
      return okStatus && okBranch;
    });
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (statsSort === "name") {
        return (a.name || "").localeCompare(b.name || "", "ko");
      }
      if (statsSort === "completed") {
        if (b.completed !== a.completed) return b.completed - a.completed;
        if (b.video_total !== a.video_total) return b.video_total - a.video_total;
        return (a.name || "").localeCompare(b.name || "", "ko");
      }
      if (statsSort === "ratio") {
        if (b.avg_watched_ratio !== a.avg_watched_ratio) {
          return b.avg_watched_ratio - a.avg_watched_ratio;
        }
        return (a.name || "").localeCompare(b.name || "", "ko");
      }
      if (statsSort === "recent") {
        const aTime = a.last_activity ? new Date(a.last_activity).getTime() : 0;
        const bTime = b.last_activity ? new Date(b.last_activity).getTime() : 0;
        if (bTime !== aTime) return bTime - aTime;
        return (a.name || "").localeCompare(b.name || "", "ko");
      }
      return 0;
    });
    return sorted;
  }, [studentStats, statsFilter, statsBranchFilter, statsSort]);

  const [statsPageSize, setStatsPageSize] = useState(20);
  const [statsPage, setStatsPage] = useState(1);
  const [openStudentIds, setOpenStudentIds] = useState<string[]>([]);
  const statsTotalPages = Math.max(1, Math.ceil(filteredStudentStats.length / statsPageSize));
  useEffect(() => {
    setStatsPage(1);
  }, [statsFilter, statsBranchFilter, statsSort, filteredStudentStats.length, statsPageSize]);
  const pagedStudentStats = useMemo(
    () =>
      (filteredStudentStats as any[]).slice(
        (statsPage - 1) * statsPageSize,
        statsPage * statsPageSize,
      ),
    [filteredStudentStats, statsPage, statsPageSize],
  );




  // 반 평균 학습 시청률 요약 (학습 현황 필터와 연동)
  const statRows = filteredStudentStats as any[];
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
            {!canWrite && (
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                조회 전용
              </span>
            )}
            {cls?.description && (
              <p className="min-w-0 truncate text-sm text-muted-foreground">{cls.description}</p>
            )}
          </div>
          {canWrite && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMessageDialogOpen(true)}
              className="shrink-0"
            >
              <MessageSquare className="mr-1 h-4 w-4" /> 문자 전송
            </Button>
          )}
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

      <VideoStudentStatsDialog
        classId={id}
        video={statsVideo}
        onClose={() => setStatsVideo(null)}
      />
      <SendMessageDialog
        open={messageDialogOpen}
        onOpenChange={setMessageDialogOpen}
        classId={id}
        className={cls?.name}
      />


      {!canWrite && !isBranchAdmin && (
        <p className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          이 수강반에 배정된 강사가 아니므로 <span className="font-semibold">조회만</span> 가능합니다. 배정·설정 변경이 필요하면 관리자에게 요청하세요.
        </p>
      )}

      <Tabs defaultValue="students" className="w-full min-w-0">
        <TabsList className={`grid w-full ${canWrite ? "grid-cols-7" : "grid-cols-6"}`}>
          <TabsTrigger value="students" className="whitespace-nowrap px-0.5 text-[10px] sm:px-1 sm:text-xs">{canWrite ? "학생 배정" : "학생"}</TabsTrigger>
          <TabsTrigger value="instructors" className="whitespace-nowrap px-0.5 text-[10px] sm:px-1 sm:text-xs">{canWrite ? "강사 배정" : "강사"}</TabsTrigger>
          <TabsTrigger value="videos" className="whitespace-nowrap px-0.5 text-[10px] sm:px-1 sm:text-xs">영상</TabsTrigger>
          <TabsTrigger value="stats" className="whitespace-nowrap px-0.5 text-[10px] sm:px-1 sm:text-xs">학습 현황</TabsTrigger>
          <TabsTrigger value="history" className="whitespace-nowrap px-0.5 text-[10px] sm:px-1 sm:text-xs">배정 이력</TabsTrigger>
          <TabsTrigger value="sms" className="whitespace-nowrap px-0.5 text-[10px] sm:px-1 sm:text-xs">문자 이력</TabsTrigger>
          {canWrite && (
            <TabsTrigger value="settings" className="whitespace-nowrap px-0.5 text-[10px] sm:px-1 sm:text-xs">설정</TabsTrigger>
          )}
        </TabsList>



        <TabsContent value="students">
      <Card>
        <CardHeader>
            <CardTitle className="flex min-w-0 items-center gap-2">
              <UserPlus className="h-5 w-5 shrink-0" /> <span className="truncate">{canWrite ? "학생 배정" : "배정된 학생"} ({students.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {canWrite && (
          <div className="rounded-md border bg-muted/20 p-3">
            <p className="mb-2 text-xs font-semibold">학생 검색 · 배정</p>
          <form onSubmit={search} className="space-y-2">

            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-end gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Label className="shrink-0 text-xs text-muted-foreground">교육원</Label>
                <Select
                  value={searchBranch}
                  onValueChange={(v) => {
                    setSearchBranch(v);
                    setSearchSchool("__all__");
                  }}
                >
                  <SelectTrigger className="h-9 w-24 sm:w-28">
                    <SelectValue placeholder="전체" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">전체</SelectItem>
                    {branchList.map((b) => (
                      <SelectItem key={b} value={b}>{b}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Label className="shrink-0 text-xs text-muted-foreground">기수</Label>
                <CohortMultiSelect
                  options={filterOptions.cohorts}
                  selected={searchCohorts}
                  onChange={setSearchCohorts}
                  width="w-28 sm:w-32"
                  placeholder="전체"
                  allLabel="전체"
                  assignMode={!filterOptions.hasNoCohort}
                />
                <Label className="shrink-0 text-xs text-muted-foreground">학교</Label>
                <Select value={searchSchool} onValueChange={setSearchSchool}>
                  <SelectTrigger className="h-9 w-28 sm:w-36">
                    <SelectValue placeholder="전체" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">전체</SelectItem>
                    {schoolOptions.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-0">
                <Label htmlFor="query" className="sr-only">이름 또는 전화번호</Label>
                <ClearableSearchInput
                  id="query"
                  value={query}
                  onChange={setQuery}
                  onClear={() => setResults([])}
                  placeholder="이름 또는 전화번호 (띄어쓰기로 여러 명)"
                  className="w-full"
                  showIcon={false}
                />
              </div>
              <Button type="submit" disabled={searching} className="shrink-0 whitespace-nowrap">
                <Search className="mr-1 h-4 w-4 shrink-0" />
                {searching ? "검색 중..." : "검색"}
              </Button>
            </div>
          </form>

          {results.length > 0 && (
            <div className="rounded-md border">
              {(() => {
                const pending = results.filter(
                  (r) => !students.some((s: any) => s.user_id === r.user_id),
                );
                const selectedTargets = pending.filter((r) => selectedIds.has(r.user_id));
                const allPendingSelected =
                  pending.length > 0 && pending.every((r) => selectedIds.has(r.user_id));
                return (
                  <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
                    <label className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                      <Checkbox
                        checked={allPendingSelected}
                        onCheckedChange={(checked) => {
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (checked) {
                              pending.forEach((r) => next.add(r.user_id));
                            } else {
                              pending.forEach((r) => next.delete(r.user_id));
                            }
                            return next;
                          });
                        }}
                        aria-label="미배정 학생 전체 선택"
                      />
                      <span className="truncate">
                        검색 결과 {results.length}명 · 미배정 {pending.length}명
                        {selectedTargets.length > 0 && ` · ${selectedTargets.length}명 선택`}
                      </span>
                    </label>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => assignAll(selectedTargets)}
                        disabled={bulkAssigning || selectedTargets.length === 0}
                        className="shrink-0 whitespace-nowrap"
                      >
                        {bulkAssigning ? "배정 중..." : `선택 배정 (${selectedTargets.length})`}
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => assignAll(pending)}
                        disabled={bulkAssigning || pending.length === 0}
                        className="shrink-0 whitespace-nowrap"
                      >
                        {bulkAssigning ? "배정 중..." : `전체 배정 (${pending.length})`}
                      </Button>
                    </div>
                  </div>
                );
              })()}
              <ul className="max-h-[420px] divide-y overflow-y-auto overscroll-contain">
                {results.map((r) => {
                  const already = students.some((s: any) => s.user_id === r.user_id);
                  return (
                    <li key={r.user_id} className="flex items-center gap-2 px-3 py-2">
                      {!already && (
                        <Checkbox
                          checked={selectedIds.has(r.user_id)}
                          onCheckedChange={(checked) => {
                            setSelectedIds((prev) => {
                              const next = new Set(prev);
                              if (checked) next.add(r.user_id);
                              else next.delete(r.user_id);
                              return next;
                            });
                          }}
                          aria-label={`${r.name} 선택`}
                          className="shrink-0"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                          <span className="truncate">{r.name}</span>
                          <BranchBadge branch={r.branch} />
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {r.phone}
                          {r.parent_phone ? ` · 학부모 ${r.parent_phone}` : ""}
                          {r.school ? ` · ${r.school}` : ""}
                          {r.cohort ? ` · ${r.cohort}` : " · 기수 미지정"}
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
          </div>
          )}

          {(() => {
            const q = assignedQuery.replace(/\s+/g, "").toLowerCase();
            const listed = (students as any[]).filter((s) => {
              const branchOk = listBranch === "__all__" || matchesBranch(listBranch, s.branch);
              if (!q) return branchOk;
              const nameMatch = (s.name || "").replace(/\s+/g, "").toLowerCase().includes(q);
              const phoneMatch = (s.phone || "").replace(/[^0-9]/g, "").includes(q);
              const parentPhoneMatch = (s.parent_phone || "").replace(/[^0-9]/g, "").includes(q);
              const schoolMatch = (s.school || "").replace(/\s+/g, "").toLowerCase().includes(q);
              const cohortMatch = String(s.cohort || "").includes(q);
              return branchOk && (nameMatch || phoneMatch || parentPhoneMatch || schoolMatch || cohortMatch);
            });
            return (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold">배정된 학생 목록 ({listed.length}/{students.length})</p>
              <Select value={listBranch} onValueChange={setListBranch}>
                <SelectTrigger className="h-8 w-full sm:w-48">
                  <SelectValue placeholder="교육원 전체 보기" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">교육원 전체 보기</SelectItem>
                  {branchList.map((b) => (
                    <SelectItem key={b} value={b}>{b}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <ClearableSearchInput
              value={assignedQuery}
              onChange={setAssignedQuery}
              placeholder="배정된 학생 이름·전화번호·학교 검색"
              className="w-full"
              showIcon={false}
            />
          {canWrite && listed.length > 0 && (() => {
            const sortedVideos = [...(videos as any[])].sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
            const allSel = listed.every((s: any) => startSel.has(s.user_id));
            return (
              <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2">
                <span className="text-xs font-semibold">학습 현황 시작 영상</span>
                <label className="flex items-center gap-1 text-xs">
                  <Checkbox
                    checked={allSel}
                    onCheckedChange={(c) => {
                      const next = new Set(startSel);
                      listed.forEach((s: any) => (c ? next.add(s.user_id) : next.delete(s.user_id)));
                      setStartSel(next);
                    }}
                  />
                  전체 선택 ({startSel.size}명 선택)
                </label>
                <Select value={startVideoId} onValueChange={setStartVideoId}>
                  <SelectTrigger className="h-8 w-full sm:w-72">
                    <SelectValue placeholder="시작할 영상 선택 (이 영상부터 포함)" />
                  </SelectTrigger>
                  <SelectContent>
                    {sortedVideos.map((v: any) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.title}{v.week_label ? ` · ${v.week_label}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" disabled={startSaving || startSel.size === 0 || !startVideoId} onClick={() => applyProgressStart(startVideoId)}>
                  적용
                </Button>
                <Button size="sm" variant="outline" disabled={startSaving || startSel.size === 0} onClick={() => applyProgressStart(null)}>
                  배정 시점으로 되돌리기
                </Button>
              </div>
            );
          })()}
          {students.length === 0 ? (
            <p className="text-sm text-muted-foreground">아직 배정된 학생이 없습니다.</p>
          ) : listed.length === 0 ? (
            <p className="text-sm text-muted-foreground">선택한 교육원에 배정된 학생이 없습니다.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {listed.map((s: any) => (

                <div
                  key={s.user_id}
                  className="flex items-center gap-1.5 rounded-md border bg-green-500/15 px-2 py-1.5"
                >
                  {canWrite && (
                    <Checkbox
                      checked={startSel.has(s.user_id)}
                      onCheckedChange={(c) => {
                        const next = new Set(startSel);
                        c ? next.add(s.user_id) : next.delete(s.user_id);
                        setStartSel(next);
                      }}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-1.5 text-sm font-medium leading-snug">
                      <span className="break-words">{s.name || s.email}</span>
                      <BranchBadge branch={s.branch} />
                    </p>
                    {s.phone && (
                      <p className="break-all text-xs text-muted-foreground">{s.phone}</p>
                    )}
                    {s.parent_phone && (
                      <p className="break-all text-xs text-muted-foreground">학부모 {s.parent_phone}</p>
                    )}
                    {s.progress_start_at && (() => {
                      const sv = (videos as any[]).find((v) => v.created_at === s.progress_start_at);
                      return (
                        <p className="break-words text-[11px] leading-snug text-primary">시작: {sv?.title ?? new Date(s.progress_start_at).toLocaleDateString("ko-KR")}</p>
                      );
                    })()}
                  </div>
                  {canWrite && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 shrink-0"
                      onClick={() => remove(s.user_id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
          </div>
            );
          })()}



        </CardContent>
      </Card>
        </TabsContent>

      {(
        <TabsContent value="instructors">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GraduationCap className="h-5 w-5 shrink-0" /> <span className="truncate">{canWrite ? "강사 배정" : "배정된 강사"} ({assignedInstructors.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              배정된 강사는 이 수강반의 학생/영상/진도를 조회하고 관리할 수 있습니다.
            </p>
            {canWrite && (
            <form onSubmit={searchI} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <div className="min-w-0">
                <Label htmlFor="iquery" className="sr-only">이름 또는 이메일</Label>
                <ClearableSearchInput
                  id="iquery"
                  value={iq}
                  onChange={setIq}
                  onClear={() => setIResults([])}
                  placeholder="강사 이름 또는 이메일 (띄어쓰기로 여러 명 검색)"
                  className="w-full"
                  showIcon={false}
                />
              </div>
              <Button type="submit" disabled={iSearching} className="shrink-0 whitespace-nowrap">
                <Search className="mr-1 h-4 w-4 shrink-0" />
                {iSearching ? "검색 중..." : "검색"}
              </Button>
            </form>
            )}

            {canWrite && iResults.length > 0 && (
              <div className="rounded-md border">
                {(() => {
                  const pending = iResults.filter(
                    (r) => !assignedInstructors.some((s: any) => s.user_id === r.user_id),
                  );
                  return (
                    <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
                      <span className="text-xs text-muted-foreground">
                        검색 결과 {iResults.length}명 · 미배정 {pending.length}명
                      </span>
                      <Button
                        size="sm"
                        onClick={() => assignAllI(pending)}
                        disabled={bulkAssigningI || pending.length === 0}
                        className="shrink-0 whitespace-nowrap"
                      >
                        {bulkAssigningI ? "배정 중..." : `전체 배정 (${pending.length})`}
                      </Button>
                    </div>
                  );
                })()}
                <ul className="max-h-[420px] divide-y overflow-y-auto overscroll-contain">
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
                    {canWrite && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 shrink-0"
                        onClick={() => removeI(s.user_id)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
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
          {!canWrite ? null : creatingUnder === undefined ? (
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
                      draggable={canWrite}
                      onDragStart={(e) => {
                        if (!canWrite) return;
                        setDraggingVideoId(v.id);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", v.id);
                      }}
                      onDragEnd={() => { setDraggingVideoId(null); setDragOverFolder(undefined); }}
                      onTouchStart={(e) => {
                        if (!canWrite) return;
                        if (longPressTimer.current) clearTimeout(longPressTimer.current);
                        longPressTimer.current = setTimeout(() => {
                          setDraggingVideoId(v.id);
                          setDragOverFolder((v.folder_id ?? null) as string | null);
                          toast.info("이동할 폴더 위로 끌어다 놓으세요.");
                        }, 500);
                      }}
                      onTouchMove={(e) => {
                        if (!draggingVideoId) {
                          if (longPressTimer.current) clearTimeout(longPressTimer.current);
                          longPressTimer.current = null;
                          return;
                        }
                        e.preventDefault();
                        const touch = e.touches[0];
                        setDragOverFolder(findFolderFromTouch(touch.clientX, touch.clientY));
                      }}
                      onTouchEnd={() => {
                        if (longPressTimer.current) clearTimeout(longPressTimer.current);
                        longPressTimer.current = null;
                        if (draggingVideoId && dragOverFolder !== undefined) {
                          handleDropOnFolder(dragOverFolder);
                        } else {
                          setDraggingVideoId(null);
                          setDragOverFolder(undefined);
                        }
                      }}
                      onTouchCancel={() => {
                        if (longPressTimer.current) clearTimeout(longPressTimer.current);
                        longPressTimer.current = null;
                        setDraggingVideoId(null);
                        setDragOverFolder(undefined);
                      }}
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
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0"
                        title="학생별 시청 현황"
                        onClick={() => setStatsVideo({ id: v.id, title: v.title })}
                      >
                        <Users className="h-4 w-4" />
                      </Button>
                      {canWrite && (
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
                      )}
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
                    data-folder-id={f.id}
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
                            <span
                              className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${
                                f.is_required
                                  ? "bg-primary/10 text-primary"
                                  : "bg-muted text-muted-foreground"
                              }`}
                            >
                              {f.is_required ? "필수 시청" : "선택 시청"}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              (폴더 {childFolders.length} · 영상 {items.length})
                            </span>
                          </div>
                          {canWrite && (
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant={f.is_required ? "secondary" : "outline"}
                              className="h-7 whitespace-nowrap px-2 text-xs"
                              onClick={() => handleToggleFolderRequired(f.id, !f.is_required)}
                            >
                              {f.is_required ? "선택으로" : "필수로"}
                            </Button>
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
                          )}
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
                      data-unassigned-zone
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
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                title="새로고침"
                disabled={statsFetching}
                onClick={async () => {
                  await refetchStats();
                  toast.success("학습 현황을 새로고침했습니다.");
                }}
              >
                <RefreshCw className={`h-4 w-4 ${statsFetching ? "animate-spin" : ""}`} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                title="전체 펼치기"
                onClick={() => {
                  setOpenStudentIds(pagedStudentStats.map((s: any) => s.user_id));
                  toast.success("모든 학생의 상세를 펼쳤습니다.");
                }}
              >
                <ChevronDown className="h-4 w-4" /> 전체 펼치기
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                title="전체 접기"
                onClick={() => {
                  setOpenStudentIds([]);
                  toast.success("모든 학생의 상세를 접었습니다.");
                }}
              >
                <ChevronUp className="h-4 w-4" /> 전체 접기
              </Button>
            </CardTitle>

            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              <div className="flex items-center gap-1">
                <Input
                  type="date"
                  value={statsFrom}
                  onChange={(e) => setStatsFrom(e.target.value)}
                  className="h-8 w-full sm:w-36 text-xs"
                  title="영상 등록일 시작"
                />
                <span className="shrink-0 text-xs text-muted-foreground">~</span>
                <Input
                  type="date"
                  value={statsTo}
                  onChange={(e) => setStatsTo(e.target.value)}
                  className="h-8 w-full sm:w-36 text-xs"
                  title="영상 등록일 종료"
                />
                {(statsFrom || statsTo) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 shrink-0 px-2 text-xs"
                    onClick={() => {
                      setStatsFrom("");
                      setStatsTo("");
                    }}
                  >
                    기간 해제
                  </Button>
                )}
              </div>
              <Select value={statsFilter} onValueChange={(v) => setStatsFilter(v as any)}>
                <SelectTrigger className="h-8 w-full sm:w-36">
                  <SelectValue placeholder="필터" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체</SelectItem>
                  <SelectItem value="completed">완료한 학생</SelectItem>
                  <SelectItem value="incomplete">미완료 학생</SelectItem>
                </SelectContent>
              </Select>
              <Select value={statsBranchFilter} onValueChange={setStatsBranchFilter}>
                <SelectTrigger className="h-8 w-full sm:w-36">
                  <SelectValue placeholder="교육원" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">교육원 전체</SelectItem>
                  {statsBranchOptions.map((b) => (
                    <SelectItem key={b} value={b}>
                      {b}
                    </SelectItem>
                  ))}
                  <SelectItem value="none">교육원 미지정</SelectItem>
                </SelectContent>
              </Select>
              <Select value={statsSort} onValueChange={(v) => setStatsSort(v as any)}>
                <SelectTrigger className="h-8 w-full sm:w-36">
                  <SelectValue placeholder="정렬" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name">이름순</SelectItem>
                  <SelectItem value="completed">완료순</SelectItem>
                  <SelectItem value="ratio">시청률순</SelectItem>
                  <SelectItem value="recent">최근 학습순</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={String(statsPageSize)}
                onValueChange={(v) => setStatsPageSize(Number(v))}
              >
                <SelectTrigger className="h-8 w-full sm:w-28">
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
              <Accordion type="multiple" value={openStudentIds} onValueChange={setOpenStudentIds} className="w-full">
                {pagedStudentStats.map((s: any) => (
                  <AccordionItem key={s.user_id} value={s.user_id}>
                    <AccordionTrigger className="px-3 hover:no-underline">
                      <div className="grid w-full grid-cols-2 gap-2 pr-2 text-left text-sm sm:grid-cols-[1fr_80px_100px_150px]">
                        <span className="inline-flex items-center gap-1 truncate font-medium">
                          {s.name || "-"}{s.phone ? ` (${s.phone})` : ""}
                          <BranchBadge branch={s.branch} />
                        </span>
                        <span className="whitespace-nowrap">{s.completed} / {s.video_total}</span>
                        <span className="whitespace-nowrap">{s.completed === s.video_total && s.video_total > 0 ? 100 : Math.min(99, Math.ceil(s.avg_watched_ratio * 100))}%</span>
                        <span className="whitespace-nowrap text-xs text-muted-foreground">
                          {s.last_activity ? new Date(s.last_activity).toLocaleString("ko-KR") : "-"}
                        </span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <StudentVideoDetail classId={id} userId={s.user_id} canEdit={canWrite} />
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
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle className="flex min-w-0 items-center gap-2">
                  <History className="h-5 w-5 shrink-0" />
                  <span className="truncate">배정 이력 ({historyTotal}건)</span>
                </CardTitle>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <ClearableSearchInput
                    placeholder="이름, 연락처, 처리자 검색"
                    value={historySearch}
                    onChange={setHistorySearch}
                    className="w-full sm:w-56"
                    size="sm"
                  />
                  <Select
                    value={String(historyPageSize)}
                    onValueChange={(v) => setHistoryPageSize(Number(v))}
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
              {pagedHistory.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {historySearchDebounced ? "검색 결과가 없습니다." : "아직 이력이 없습니다."}
                </p>

              ) : (
                <div>
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
                        {pagedHistory.map((h: any) => (
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
                  <div className="mt-3 flex flex-col items-center justify-between gap-2 border-t pt-3 sm:flex-row">
                    <span className="text-xs text-muted-foreground">
                      총 {historyTotal}건 · {historyPage} / {historyTotalPages} 페이지
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={historyPage <= 1}
                        onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                      >
                        이전
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={historyPage >= historyTotalPages}
                        onClick={() => setHistoryPage((p) => Math.min(historyTotalPages, p + 1))}
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


        {canWrite && (
          <TabsContent value="sms">
            <SmsLogPanel classId={id} />
          </TabsContent>
        )}


        <TabsContent value="settings">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>수강반 설정</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="s_name" className="mb-2 block">수강반 이름</Label>
                    {settingsClassType === "내신" ? (
                      <NaesinClassNamePicker
                        initialName={clsAny?.name ?? ""}
                        onChange={(n, b) => {
                          if (n) setSettingsName(n);
                          else if (isValidNaesinClassName(settingsName)) setSettingsName("");
                          if (b) setSettingsBranch(b);
                        }}
                      />
                    ) : (
                    <Input
                      id="s_name"
                      value={settingsName}
                      onChange={(e) => setSettingsName(e.target.value)}
                      placeholder="예: 19기 정규반"
                    />
                    )}
                  </div>
                  <div>
                    <Label htmlFor="s_desc" className="mb-2 block">설명</Label>
                    <Textarea
                      id="s_desc"
                      value={settingsDesc}
                      onChange={(e) => setSettingsDesc(e.target.value)}
                      placeholder="수강반 설명 (선택)"
                      rows={3}
                    />
                  </div>
                </div>

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

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <Label className="mb-2 block">수강반 유형</Label>
                    <Select value={settingsClassType} onValueChange={setSettingsClassType}>
                      <SelectTrigger>
                        <SelectValue placeholder="유형 선택" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="정규">정규</SelectItem>
                        <SelectItem value="내신">내신</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="mb-2 block">카테고리</Label>
                    <Select value={settingsCategory} onValueChange={setSettingsCategory}>
                      <SelectTrigger>
                        <SelectValue placeholder="카테고리 선택" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">미지정</SelectItem>
                        {(categories as any[]).map((cat) => (
                          <SelectItem key={cat.id} value={cat.id}>
                            {cat.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="mb-2 block">공개 교육원</Label>
                    <Select value={settingsBranch} onValueChange={setSettingsBranch}>
                      <SelectTrigger>
                        <SelectValue placeholder="교육원 선택" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all_branches__">모든 교육원 (전체 공개)</SelectItem>
                        {BRANCH_OPTIONS.map((b) => (
                          <SelectItem key={b} value={b}>
                            {b} 전용
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="mt-1 text-xs text-muted-foreground">
                      특정 교육원 전용으로 설정하면 해당 교육원 강사만 조회할 수 있습니다.
                    </p>
                  </div>
                </div>

                <Button onClick={saveSettings} disabled={!isSettingsDirty || savingSettings || (settingsClassType === "내신" && !isValidNaesinClassName(settingsName))}>
                  {savingSettings ? "저장 중..." : "저장"}
                </Button>
              </CardContent>
            </Card>

            <ExternalAssignmentPanel classId={id} className={cls?.name ?? ""} />
          </div>
        </TabsContent>
      </Tabs>


    </div>
  );
}
