import { createFileRoute, useBlocker } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Trash2, RefreshCw, Save, Settings2, RotateCcw, EyeOff, Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { listVideoClassStudents, listVideoExclusions, setVideoExclusion } from "@/lib/video-exclusions.functions";
import { deleteVideo, refreshVideoStatus } from "@/lib/vimeo.functions";
import { listClasses, updateVideo, getVideoCreatorNames } from "@/lib/classes.functions";
import { WeekPicker } from "@/components/admin/WeekPicker";
import { ClearableSearchInput } from "@/components/admin/ClearableSearchInput";
import { formatWeekLabel } from "@/lib/week";
import { isValidRegularVideoTitle } from "@/lib/naming";
import { RegularVideoTitlePicker, FormatWarningBadge } from "@/components/admin/NamingPickers";
import { restoreItem, purgeItem } from "@/lib/trash.functions";
import { useAdminRole, RoleGate } from "@/components/AdminRole";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { VideoThumb } from "@/components/VideoThumb";
import { prefetchSignedThumbUrls, extractStoragePath } from "@/lib/signed-url-cache";
import { VideoThumbnailUploader } from "@/components/VideoThumbnailUploader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { VideoUploadForm } from "@/components/admin/VideoUploadForm";
import { Upload as UploadIcon, Film } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { VideoUnlockPanel } from "@/components/admin/VideoUnlockManager";

export const Route = createFileRoute("/admin/videos")({
  head: () => ({ meta: [{ title: "영상 관리 | 이재식 이러닝" }, { name: "description", content: "영상 설정과 학생별 숨김 및 개별 열기를 관리합니다." }, { property: "og:title", content: "영상 관리 | 이재식 이러닝" }, { property: "og:description", content: "영상별 학습 설정과 학생 접근을 관리합니다." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: VideosPage,
});

type Row = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  source: string;
  vimeo_video_id: string | null;
  external_video_id: string | null;
  thumbnail_url: string | null;
  class_id: string | null;
  is_published: boolean;
  sort_order: number;
  allow_seek: boolean;
  max_playback_rate: number;
  rewatch_allow_seek: boolean | null;
  rewatch_max_playback_rate: number | null;
  completion_ratio: number;
  week_label: string | null;
  created_at: string;
  created_by?: string;
  upload_duration_ms?: number | null;
  file_size_bytes?: number | null;
  upload_stalled_ms?: number | null;
  upload_retry_count?: number | null;
};

function formatUploadDuration(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}분 ${s}초` : `${s}초`;
}

function formatFileSize(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)}GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))}MB`;
}

function formatUploadSpeed(bytes: number, ms: number) {
  const mbps = bytes / 1024 ** 2 / (ms / 1000);
  return `${mbps.toFixed(1)}MB/s`;
}

const NO_CLASS = "__none__";

const statusMap: Record<string, string> = {
  ready: "재생 가능",
  transcode_starting: "변환 시작",
  transcoding: "변환 중",
  transcode_error: "변환 오류",
  uploading: "업로드 중",
  uploading_error: "업로드 오류",
  quota_exceeded: "할당량 초과",
  pending: "대기 중",
  available: "재생 가능",
};
const statusLabel = (s: string) => statusMap[s] ?? s;


// 영상을 숨길 학생 관리 (수강반 배정 학생 중 선택)
function VideoExclusionManager({ videoId, query }: { videoId: string; query: string }) {
  const qc = useQueryClient();
  const { data: students = [], isLoading: loadingStudents } = useQuery({
    queryKey: ["admin", "video", videoId, "class-students"],
    queryFn: () => listVideoClassStudents({ data: { videoId } }),
  });
  const { data: hiddenIds = [], isLoading: loadingHidden } = useQuery({
    queryKey: ["admin", "video", videoId, "exclusions"],
    queryFn: () => listVideoExclusions({ data: { videoId } }),
  });

  const toggle = useMutation({
    mutationFn: (p: { userId: string; hidden: boolean }) =>
      setVideoExclusion({ data: { videoId, userId: p.userId, hidden: p.hidden } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "video", videoId, "exclusions"] });
      qc.invalidateQueries({ queryKey: ["video-unlocks"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "처리에 실패했습니다."),
  });

  const hiddenSet = new Set(hiddenIds as string[]);

  const isSearching = query.trim().length > 0;

  // 띄어쓰기로 구분된 여러 검색어를 OR로 매칭 (이름·학교·학년·교육원·연락처)
  const listed = useMemo(() => {
    const all = students as any[];
    const tokens = query.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return all;
    return all.filter((s) =>
      tokens.some((t) => {
        const norm = t.replace(/\s+/g, "").toLowerCase();
        const digits = t.replace(/[^0-9]/g, "");
        const name = (s.name || "").replace(/\s+/g, "").toLowerCase();
        const school = (s.school || "").replace(/\s+/g, "").toLowerCase();
        const grade = String(s.grade || "").replace(/\s+/g, "").toLowerCase();
        const branch = String(s.branch || "").replace(/\s+/g, "").toLowerCase();
        const phone = String(s.phone || "").replace(/[^0-9]/g, "");
        const parentPhone = String(s.parent_phone || "").replace(/[^0-9]/g, "");
        return (
          (norm.length > 0 &&
            (name.includes(norm) ||
              school.includes(norm) ||
              grade.includes(norm) ||
              branch.includes(norm))) ||
          (digits.length > 0 &&
            (phone.includes(digits) || parentPhone.includes(digits)))
        );
      }),
    );
  }, [students, query]);

  return (
    <div className="min-w-0 rounded-md border p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium">
        <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
        학생별 숨기기
        {hiddenSet.size > 0 && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {hiddenSet.size}명 숨김
          </span>
        )}
      </div>
      {loadingStudents || loadingHidden ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> 불러오는 중...
        </p>
      ) : (students as any[]).length === 0 ? (
        <p className="text-xs text-muted-foreground">수강반에 배정된 학생이 없습니다.</p>
      ) : (
        <div className="min-w-0 space-y-2">
          {isSearching && (
            <p className="text-[11px] text-muted-foreground">
              {`일치하는 학생 ${listed.length}명 / 전체 ${(students as any[]).length}명`}
            </p>
          )}
          {listed.length === 0 ? (
            <p className="py-1 text-xs text-muted-foreground">
              {`"${query.trim()}"에 해당하는 학생이 없습니다.`}
            </p>
          ) : (
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {listed.map((s) => (
                <label
                  key={s.user_id}
                  className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted"
                >
                  <Checkbox
                    checked={hiddenSet.has(s.user_id)}
                    disabled={toggle.isPending}
                    onCheckedChange={(c) =>
                      toggle.mutate({ userId: s.user_id, hidden: c === true })
                    }
                  />
                  <span className="truncate">
                    {s.name || "(이름 없음)"}
                    <span className="ml-1 text-xs text-muted-foreground">
                      {[s.school, s.grade, s.branch].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        체크한 학생에게는 이 영상이 목록에 보이지 않고, 학습 현황 계산에서도 제외됩니다.
      </p>
    </div>
  );
}

function VideosPage() {
  const { isAdmin } = useAdminRole();
  const [rows, setRows] = useState<Row[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Row>>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [studentAccessQuery, setStudentAccessQuery] = useState("");

  const dirty = (id: string) => !!edits[id] && Object.keys(edits[id]!).length > 0;

  const hasUnsavedChanges = Object.keys(edits).some((id) => dirty(id));

  useBlocker({
    shouldBlockFn: () =>
      hasUnsavedChanges
        ? !window.confirm("변경사항이 저장되지 않았습니다. 페이지를 나가시겠습니까?")
        : false,
    enableBeforeUnload: hasUnsavedChanges,
  });


  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsavedChanges]);

  const { data: classesData } = useQuery({
    queryKey: ["admin", "classes"],
    queryFn: () => listClasses(),
  });
  const classes = useMemo(() => (classesData ?? []) as any[], [classesData]);


  const PAGE_SIZE = 20;
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [classFilter, setClassFilter] = useState<string>("__all__");
  const [sourceFilter, setSourceFilter] = useState<string>("__all__");
  const [total, setTotal] = useState(0);
  const [listLoading, setListLoading] = useState(false);
  const [unassignedCount, setUnassignedCount] = useState(0);
  const [createdByNames, setCreatedByNames] = useState<Record<string, string>>({});
  const creatorNamesCache = useRef<Record<string, string>>({});
  const resolveCreatorNames = useServerFn(getVideoCreatorNames);

  const allowedIds = (classes as any[]).map((c) => c.id);
  const regularClassIds = useMemo(
    () => new Set((classes as any[]).filter((c) => c.class_type === "정규").map((c) => c.id as string)),
    [classes],
  );
  const isUnformatted = (r: { class_id: string | null; title: string }) =>
    !!r.class_id && regularClassIds.has(r.class_id) && !isValidRegularVideoTitle(r.title);
  const [onlyUnformatted, setOnlyUnformatted] = useState(false);

  const buildQuery = (trash: boolean) => {
    let q = supabase
      .from("videos")
      .select(
        trash
          ? "id,title,description,status,source,vimeo_video_id,external_video_id,thumbnail_url,class_id,is_published,sort_order,allow_seek,max_playback_rate,rewatch_allow_seek,rewatch_max_playback_rate,completion_ratio,week_label,created_at,created_by,upload_duration_ms,file_size_bytes,upload_stalled_ms,upload_retry_count,deleted_at,deleted_by"
          : "id,title,description,status,source,vimeo_video_id,external_video_id,thumbnail_url,class_id,is_published,sort_order,allow_seek,max_playback_rate,rewatch_allow_seek,rewatch_max_playback_rate,completion_ratio,week_label,created_at,created_by,upload_duration_ms,file_size_bytes,upload_stalled_ms,upload_retry_count",
        { count: "exact" },
      );
    q = trash ? q.not("deleted_at", "is", null) : q.is("deleted_at", null);
    // 강사는 접근 가능한 수강반의 영상만 (DB에서 필터)
    if (!isAdmin) q = q.in("class_id", allowedIds.length > 0 ? allowedIds : ["00000000-0000-0000-0000-000000000000"]);
    if (classFilter !== "__all__") {
      q = classFilter === NO_CLASS ? q.is("class_id", null) : q.eq("class_id", classFilter);
    }
    if (isAdmin && sourceFilter !== "__all__") {
      q = q.eq("source", sourceFilter);
    }
    return q;
  };

  // 실제 "미지정" 영상 개수를 확인해 필터 옵션 노출 결정
  useEffect(() => {
    let cancelled = false;
    const countUnassigned = async () => {
      if (!isAdmin) {
        setUnassignedCount(0);
        return;
      }
      const { count } = await supabase
        .from("videos")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null)
        .is("class_id", null);
      if (!cancelled) setUnassignedCount(count ?? 0);
    };
    countUnassigned();
    return () => { cancelled = true; };
  }, [isAdmin]);

  useEffect(() => {
    if (classFilter === NO_CLASS && unassignedCount === 0) {
      setClassFilter("__all__");
    }
  }, [classFilter, unassignedCount]);

  const load = async () => {
    if (!isAdmin && allowedIds.length === 0) {
      setRows([]);
      setTotal(0);
      return;
    }
    setListLoading(true);
    let q = buildQuery(false);
    const term = search.trim();
    if (term) q = q.ilike("title", `%${term}%`);
    const from = (page - 1) * PAGE_SIZE;
    const { data, count } = await q
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    const loaded = ((data as any[] | null) ?? []) as Row[];
    setRows(loaded);
    // 썸네일 서명 주소를 한 번에 묶어 미리 발급받아 표시 속도를 높인다.
    const thumbPaths = (loaded as Row[])
      .map((r) => extractStoragePath("video-thumbnails", r.thumbnail_url ?? ""))
      .filter((p): p is string => !!p);
    if (thumbPaths.length > 0) prefetchSignedThumbUrls("video-thumbnails", thumbPaths);
    setTotal(count ?? 0);
    setEdits({});
    setListLoading(false);

    // Vimeo 처리 중이라 미리보기 이미지가 임시(placeholder)로 저장된 영상은 자동으로 다시 조회해 채운다.
    const pending = loaded
      .filter(
        (r) =>
          r.source !== "youtube" &&
          r.vimeo_video_id &&
          (!r.thumbnail_url || r.thumbnail_url.includes("/default-") || r.status !== "ready"),
      )
      .slice(0, 8);
    if (pending.length > 0) {
      void Promise.all(
        pending.map(async (r) => {
          try {
            await refreshVideoStatus({ data: { id: r.id } });
            const { data: fresh } = await supabase
              .from("videos")
              .select("id,thumbnail_url,status")
              .eq("id", r.id)
              .maybeSingle();
            if (fresh) {
              setRows((prev) =>
                prev.map((x) =>
                  x.id === r.id
                    ? { ...x, thumbnail_url: (fresh as any).thumbnail_url, status: (fresh as any).status }
                    : x,
                ),
              );
            }
          } catch {
            // 조회 실패는 무시 (Vimeo 처리 완료 후 다음 로딩에서 재시도)
          }
        }),
      );
    }


    if (isAdmin) {
      const creatorIds = [...new Set(loaded.map((r) => r.created_by).filter(Boolean))] as string[];
      // 이미 확인한 업로더는 다시 조회하지 않음 (이름은 거의 바뀌지 않음)
      const missingIds = creatorIds.filter((id) => !(id in creatorNamesCache.current));
      if (missingIds.length > 0) {
        try {
          const map = await resolveCreatorNames({ data: { userIds: missingIds } });
          Object.assign(creatorNamesCache.current, map);
        } catch {
          // 조회 실패 시 캐시는 유지하고 표시만 생략
        }
      }
      setCreatedByNames({ ...creatorNamesCache.current });
    }
  };
  useEffect(() => { load(); }, [isAdmin, classes, page, search, classFilter, sourceFilter]);
  useEffect(() => { setPage(1); }, [search, classFilter, sourceFilter]);
  useEffect(() => { if (!isAdmin) setSourceFilter("__all__"); }, [isAdmin]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const [trashRows, setTrashRows] = useState<Row[]>([]);
  const [trashTotal, setTrashTotal] = useState(0);
  const [trashLoading, setTrashLoading] = useState(false);
  const loadTrash = async () => {
    if (!isAdmin && allowedIds.length === 0) {
      setTrashRows([]);
      setTrashTotal(0);
      return;
    }
    setTrashLoading(true);
    const { data, count } = await buildQuery(true)
      .order("deleted_at", { ascending: false })
      .range(0, 49);
    const rows = ((data as any[] | null) ?? []) as Row[];
    setTrashRows(rows);
    setTrashTotal(count ?? 0);
    setTrashLoading(false);

    // 삭제한 사람 이름 조회 (최고 관리자 전용, 업로더 이름 캐시 재사용)
    if (isAdmin) {
      const deleterIds = [...new Set(rows.map((r) => (r as any).deleted_by).filter(Boolean))] as string[];
      const missingIds = deleterIds.filter((id) => !(id in creatorNamesCache.current));
      if (missingIds.length > 0) {
        try {
          const map = await resolveCreatorNames({ data: { userIds: missingIds } });
          Object.assign(creatorNamesCache.current, map);
        } catch {
          // 조회 실패 시 캐시는 유지하고 표시만 생략
        }
      }
      setCreatedByNames({ ...creatorNamesCache.current });
    }
  };

  useEffect(() => { loadTrash(); }, [isAdmin, classes]);

  const restore = async (id: string) => {
    try {
      await restoreItem({ data: { entity: "videos", id } });
      toast.success("복원되었습니다.");
      loadTrash();
      load();
    } catch (err: any) {
      toast.error(err?.message ?? "복원 실패");
    }
  };

  const purge = async (id: string, title: string) => {
    if (!confirm(`"${title}" 영상을 영구 삭제하시겠습니까? DB와 Vimeo 라이브러리에서 모두 삭제됩니다.`)) return;
    try {
      await purgeItem({ data: { entity: "videos", id } });
      toast.success("영구 삭제되었습니다.");
      loadTrash();
    } catch (err: any) {
      toast.error(err?.message ?? "영구 삭제 실패");
    }
  };




  const patch = (id: string, p: Partial<Row>) =>
    setEdits((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...p } }));

  const value = <K extends keyof Row>(r: Row, k: K): Row[K] =>
    edits[r.id] && k in edits[r.id]! && edits[r.id]![k] !== undefined ? (edits[r.id]![k] as Row[K]) : r[k];


  const save = async (r: Row) => {
    const e = edits[r.id];
    if (!e) return;
    if (e.title !== undefined && !e.title.trim()) {
      toast.error("제목이 완성되지 않았습니다. 월/주차·내용을 확인하세요.");
      return;
    }
    try {
      await updateVideo({
        data: {
          id: r.id,
          title: e.title,
          description: e.description === undefined ? undefined : e.description,
          class_id: e.class_id === undefined ? undefined : e.class_id,
          is_published: e.is_published,
          sort_order: e.sort_order,
          allow_seek: e.allow_seek,
          max_playback_rate: e.max_playback_rate,
          rewatch_allow_seek: e.rewatch_allow_seek,
          rewatch_max_playback_rate: e.rewatch_max_playback_rate,
          completion_ratio: e.completion_ratio,
          week_label: e.week_label === undefined ? undefined : e.week_label,
        },
      });
      toast.success("저장되었습니다.");
      setOpenId(null);
      load();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("휴지통으로 이동하시겠습니까? 휴지통에서 복원할 수 있습니다.")) return;
    try {
      await deleteVideo({ data: { id } });
      toast.success("휴지통으로 이동했습니다.");
      load();
      loadTrash();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const refresh = async (id: string) => {
    try {
      const r = await refreshVideoStatus({ data: { id } });
      toast.success(`상태: ${statusLabel(r.status)}`);
      load();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <RoleGate>
      <Tabs defaultValue="list" className="w-full">
        <TabsList>
          <TabsTrigger value="list" className="gap-2">
            <Film className="h-4 w-4" /> 등록된 영상
          </TabsTrigger>
          <TabsTrigger value="upload" className="gap-2">
            <UploadIcon className="h-4 w-4" /> 영상 업로드
          </TabsTrigger>
          <TabsTrigger value="trash" className="gap-2">
            <Trash2 className="h-4 w-4" /> 휴지통 ({trashTotal})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="trash" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle>휴지통 ({trashTotal}{trashTotal > 50 ? ", 최근 50건 표시" : ""})</CardTitle>
            </CardHeader>
            <CardContent>
              {trashLoading ? (
                <p className="text-sm text-muted-foreground">불러오는 중...</p>
              ) : trashRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">삭제된 영상이 없습니다.</p>
              ) : (
                <ul className="divide-y">
                  {trashRows.map((r) => (
                    <li key={r.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:gap-4">
                      <div className="h-14 w-24 shrink-0 overflow-hidden rounded bg-muted">
                        {r.thumbnail_url && (
                          <VideoThumb src={r.thumbnail_url} alt="" className="h-full w-full object-cover" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{r.title}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          삭제일{" "}
                          {(r as any).deleted_at
                            ? new Date((r as any).deleted_at).toLocaleString("ko-KR")
                            : "-"}
                          {" · "}
                          {(r as any).source === "youtube" ? "유튜브" : "파일 업로드"}
                          {r.class_id && (
                            <>
                              {" · "}
                              {(classes as any[]).find((c) => c.id === r.class_id)?.name ?? "미지정"}
                            </>
                          )}
                          {isAdmin && (r as any).deleted_by && createdByNames[(r as any).deleted_by] && (
                            <>
                              {" · 삭제한 사람 "}
                              {createdByNames[(r as any).deleted_by]}
                            </>
                          )}
                        </p>
                      </div>
                      <div className="flex shrink-0 justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => restore(r.id)}>
                          <RotateCcw className="mr-1 h-4 w-4" /> 복원
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => purge(r.id, r.title)}>
                          <Trash2 className="mr-1 h-4 w-4" /> 영구 삭제
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>


        <TabsContent value="upload" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle>새 영상 추가</CardTitle>
            </CardHeader>
            <CardContent>
              <VideoUploadForm onUploaded={() => load()} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="list" className="pt-4">
          <Card>
            <CardHeader className="gap-3">
              <CardTitle>등록된 영상 ({total})</CardTitle>
              <div className="flex flex-col gap-2 sm:flex-row">
                <form
                  className="flex flex-1 gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setSearch(searchInput);
                  }}
                >
                  <Input
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="영상 제목 검색"
                    className="max-w-xs"
                  />
                  <Button type="submit" variant="outline" size="sm">검색</Button>
                  {search && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => { setSearchInput(""); setSearch(""); }}
                    >
                      초기화
                    </Button>
                  )}
                </form>
                <Select value={classFilter} onValueChange={setClassFilter}>
                  <SelectTrigger className="w-full sm:w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                    <SelectItem value="__all__">전체 수강반</SelectItem>
                    {unassignedCount > 0 && <SelectItem value={NO_CLASS}>미지정</SelectItem>}
                    {(classes as any[]).map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <label className="flex shrink-0 items-center gap-1.5 text-xs">
                  <input type="checkbox" checked={onlyUnformatted} onChange={(e) => setOnlyUnformatted(e.target.checked)} />
                  형식 미준수만
                </label>
                {isAdmin && (
                  <Select value={sourceFilter} onValueChange={setSourceFilter}>
                    <SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">전체 방식</SelectItem>
                      <SelectItem value="vimeo">파일 업로드</SelectItem>
                      <SelectItem value="youtube">유튜브 링크</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {listLoading ? (
                <p className="text-sm text-muted-foreground">불러오는 중...</p>
              ) : rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {search || classFilter !== "__all__" ? "조건에 맞는 영상이 없습니다." : "아직 없습니다."}
                </p>
              ) : (

                <ul className="divide-y">
                  {rows.filter((r) => !onlyUnformatted || isUnformatted(r)).map((r) => (
                    <li key={r.id} className="py-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                        <div className="h-14 w-24 shrink-0 overflow-hidden rounded bg-muted">
                          {r.thumbnail_url && (
                            <VideoThumb src={r.thumbnail_url} alt="" className="h-full w-full object-cover" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">
                            {r.title}
                            {isUnformatted(r) && <FormatWarningBadge className="ml-2 align-middle" />}
                            {r.week_label && (
                              <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-normal text-primary">
                                {formatWeekLabel(r.week_label)}
                              </span>
                            )}
                            {!r.is_published && (
                              <span className="ml-2 rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-normal text-destructive">
                                비공개
                              </span>
                            )}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            <span className="uppercase">{r.source}</span>
                            {" · "}상태:{" "}
                            <span className={r.status === "ready" ? "text-green-600" : "text-amber-600"}>
                              {statusLabel(r.status)}
                            </span>
                            {r.class_id && (
                              <>
                                {" · "}
                                <span className="truncate">
                                  {(classes as any[]).find((c) => c.id === r.class_id)?.name ?? "미지정"}
                                </span>
                              </>
                            )}
                            {" · "}등록: {new Date(r.created_at).toLocaleDateString("ko-KR")}
                          </p>
                          {isAdmin && (
                            <p className="truncate text-xs text-muted-foreground mt-1">
                              {[
                                r.created_by && createdByNames[r.created_by]
                                  ? `업로더: ${createdByNames[r.created_by]}`
                                  : null,
                                typeof r.upload_duration_ms === "number"
                                  ? `업로드 소요: ${formatUploadDuration(r.upload_duration_ms)}`
                                  : null,
                                typeof r.file_size_bytes === "number" && r.file_size_bytes > 0
                                  ? `용량: ${formatFileSize(r.file_size_bytes)}`
                                  : null,
                                typeof r.upload_stalled_ms === "number" && r.upload_stalled_ms > 0
                                  ? `멈춤: ${formatUploadDuration(r.upload_stalled_ms)}`
                                  : null,
                                typeof r.upload_retry_count === "number" && r.upload_retry_count > 0
                                  ? `재시도: ${r.upload_retry_count}회`
                                  : null,
                                typeof r.file_size_bytes === "number" &&
                                typeof r.upload_duration_ms === "number" &&
                                r.file_size_bytes > 0 &&
                                r.upload_duration_ms > 0
                                  ? `평균 ${formatUploadSpeed(r.file_size_bytes, r.upload_duration_ms)}`
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center justify-end gap-1 sm:gap-2">
                          {r.source === "vimeo" && (
                            <Button size="sm" variant="ghost" onClick={() => refresh(r.id)} title="상태 새로고침">
                              <RefreshCw className="h-4 w-4" />
                            </Button>
                          )}
                          <Button size="sm" variant="outline" onClick={() => setOpenId(r.id)}>
                            <Settings2 className="mr-1 h-4 w-4" /> 설정
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => remove(r.id)} title="삭제">
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>

                      <Dialog
                        open={openId === r.id}
                        onOpenChange={(o) => {
                          if (!o && dirty(r.id)) {
                            const confirmed = window.confirm("변경사항이 저장되지 않았습니다. 닫으시겠습니까?");
                            if (!confirmed) return;
                          }
                          setOpenId(o ? r.id : null);
                          if (!o) {
                            setEdits((prev) => {
                              const next = { ...prev };
                              delete next[r.id];
                              return next;
                            });
                          }
                        }}
                      >
                        <DialogContent className="max-h-[90dvh] max-w-3xl overflow-x-hidden overflow-y-auto">
                          <DialogHeader className="min-w-0">
                            <DialogTitle className="truncate">{r.title}</DialogTitle>
                            <DialogDescription>영상 설정을 편집합니다.</DialogDescription>
                          </DialogHeader>
                          <div className="min-w-0 space-y-4">
                            <div>
                              <label className="text-xs text-muted-foreground">제목</label>
                              {(() => {
                                const cid = value(r, "class_id") as string | null;
                                if (cid && regularClassIds.has(cid)) {
                                  return (
                                    <div className="mt-1">
                                      <RegularVideoTitlePicker
                                        key={`${r.id}-${cid}`}
                                        initialTitle={r.title}
                                        weekLabel={(value(r, "week_label") as string | null) ?? null}
                                        onChange={(t, wl) => {
                                          const p: Partial<Row> = {};
                                          if (t && t !== r.title) p.title = t;
                                          else if (!t && isValidRegularVideoTitle(r.title)) p.title = ""; // 미완성 → 저장 불가
                                          else p.title = undefined as any;
                                          if (wl && wl !== (value(r, "week_label") as string | null)) p.week_label = wl;
                                          setEdits((prev) => {
                                            const cur = { ...(prev[r.id] ?? {}), ...p };
                                            if (cur.title === undefined) delete (cur as any).title;
                                            if (Object.keys(cur).length === 0) {
                                              if (!prev[r.id]) return prev;
                                              const next = { ...prev };
                                              delete next[r.id];
                                              return next;
                                            }
                                            return { ...prev, [r.id]: cur };
                                          });
                                        }}
                                      />
                                    </div>
                                  );
                                }
                                return (
                                  <Input
                                    value={value(r, "title") as string}
                                    onChange={(e) => patch(r.id, { title: e.target.value })}
                                    placeholder="영상 제목"
                                    className="mt-1"
                                  />
                                );
                              })()}
                            </div>
                            <WeekPicker
                              id={`week-${r.id}`}
                              value={(value(r, "week_label") as string | null) ?? null}
                              onChange={(v) => patch(r.id, { week_label: v })}
                            />
                            <div>
                              <label className="text-xs text-muted-foreground">설명</label>
                              <Textarea
                                value={(value(r, "description") as string | null) ?? ""}
                                onChange={(e) => patch(r.id, { description: e.target.value })}
                                placeholder="영상 설명 (선택)"
                                rows={3}
                                className="mt-1"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-muted-foreground">썸네일</label>
                              <div className="mt-1">
                                <VideoThumbnailUploader
                                  videoId={r.id}
                                  currentUrl={r.thumbnail_url}
                                  onChange={(url) =>
                                    setRows((prev) =>
                                      prev.map((x) => (x.id === r.id ? { ...x, thumbnail_url: url } : x)),
                                    )
                                  }
                                />
                              </div>
                            </div>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_100px]">
                              <div>
                                <label className="text-xs text-muted-foreground">수강반</label>
                                <Select
                                  value={(value(r, "class_id") as string | null) ?? NO_CLASS}
                                  onValueChange={(v) => patch(r.id, { class_id: v === NO_CLASS ? null : v })}
                                >
                                  <SelectTrigger><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value={NO_CLASS}>미지정</SelectItem>
                                    {classes.map((c: any) => (
                                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div>
                                <label className="text-xs text-muted-foreground">순서</label>
                                <Input
                                  type="number"
                                  value={value(r, "sort_order") as number}
                                  onChange={(e) => patch(r.id, { sort_order: Number(e.target.value) })}
                                />
                              </div>
                            </div>

                            <div className="flex items-center gap-6">
                              <div className="flex items-center gap-2">
                                <Switch
                                  checked={value(r, "is_published") as boolean}
                                  onCheckedChange={(v) => patch(r.id, { is_published: v })}
                                />
                                <span className="text-xs">공개</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Switch
                                  checked={value(r, "allow_seek") as boolean}
                                  onCheckedChange={(v) => patch(r.id, { allow_seek: v })}
                                />
                                <span className="text-xs">건너뛰기 허용</span>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                              <div>
                                <label className="text-xs text-muted-foreground">최대 배속</label>
                                <Select
                                  value={String(value(r, "max_playback_rate") as number)}
                                  onValueChange={(v) => patch(r.id, { max_playback_rate: Number(v) })}
                                >
                                  <SelectTrigger><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {[1, 1.25, 1.5, 1.75, 2, 2.5, 3].map((v) => (
                                      <SelectItem key={v} value={String(v)}>{v}x</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div>
                                <label className="text-xs text-muted-foreground">수강 완료 기준</label>
                                <Select
                                  value={String(Math.round(Number(value(r, "completion_ratio") ?? 1) * 100))}
                                  onValueChange={(v) => patch(r.id, { completion_ratio: Number(v) / 100 })}
                                >
                                  <SelectTrigger><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {[50, 60, 70, 80, 90, 95, 100].map((v) => (
                                      <SelectItem key={v} value={String(v)}>{v}%</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                            </div>

                            <div className="border-t pt-4">
                              <div className="mb-2">
                                <p className="text-sm font-medium">재시청 설정</p>
                                <p className="text-xs text-muted-foreground">
                                  수강 완료 이후 재시청 시 적용됩니다. 비워두면 처음 시청 설정과 동일하게 동작합니다.
                                </p>
                              </div>
                              <div className="flex items-center gap-2 mb-3">
                                <Switch
                                  checked={(value(r, "rewatch_allow_seek") as boolean | null) ?? (value(r, "allow_seek") as boolean)}
                                  onCheckedChange={(v) => patch(r.id, { rewatch_allow_seek: v })}
                                />
                                <span className="text-xs">재시청 시 건너뛰기 허용</span>
                                {(edits[r.id]?.rewatch_allow_seek !== undefined || r.rewatch_allow_seek !== null) && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="ml-auto h-6 text-xs"
                                    onClick={() => patch(r.id, { rewatch_allow_seek: null })}
                                  >
                                    처음 설정과 동일
                                  </Button>
                                )}
                              </div>
                              <div>
                                <label className="text-xs text-muted-foreground">재시청 최대 배속</label>
                                <div className="flex items-center gap-2 mt-1">
                                  <Select
                                    value={String((value(r, "rewatch_max_playback_rate") as number | null) ?? (value(r, "max_playback_rate") as number))}
                                    onValueChange={(v) => patch(r.id, { rewatch_max_playback_rate: Number(v) })}
                                  >
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      {[1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4].map((v) => (
                                        <SelectItem key={v} value={String(v)}>{v}x</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  {(edits[r.id]?.rewatch_max_playback_rate !== undefined || r.rewatch_max_playback_rate !== null) && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-8 text-xs shrink-0"
                                      onClick={() => patch(r.id, { rewatch_max_playback_rate: null })}
                                    >
                                      처음 설정과 동일
                                    </Button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                          </div>
                          {r.class_id && <div className="space-y-2">
                            <ClearableSearchInput value={studentAccessQuery} onChange={setStudentAccessQuery} placeholder="이름·학교·학년·교육원·전화번호 검색 (띄어쓰기로 여러 명)" size="sm" />
                            <div className="grid gap-3 md:grid-cols-2"><VideoExclusionManager videoId={r.id} query={studentAccessQuery} /><VideoUnlockPanel classId={r.class_id} videoId={r.id} query={studentAccessQuery} /></div>
                          </div>}
                          <DialogFooter>
                            <Button variant="outline" onClick={() => setOpenId(null)}>취소</Button>
                            <Button disabled={!dirty(r.id)} onClick={() => save(r)}>
                              <Save className="mr-1 h-4 w-4" /> 저장
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </li>
                  ))}
                </ul>
              )}
              {total > PAGE_SIZE && (
                <div className="mt-4 flex items-center justify-between border-t pt-4">
                  <span className="text-xs text-muted-foreground">
                    {page} / {totalPages} 페이지
                  </span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      이전
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    >
                      다음
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>

          </Card>
        </TabsContent>
      </Tabs>
    </RoleGate>
  );
}
