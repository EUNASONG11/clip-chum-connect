import { createFileRoute, useBlocker } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Trash2, RefreshCw, Save, Settings2, RotateCcw } from "lucide-react";
import { deleteVideo, refreshVideoStatus } from "@/lib/vimeo.functions";
import { listClasses, updateVideo } from "@/lib/classes.functions";
import { WeekPicker } from "@/components/admin/WeekPicker";
import { formatWeekLabel } from "@/lib/week";
import { restoreItem, purgeItem } from "@/lib/trash.functions";
import { useAdminRole, RoleGate } from "@/components/AdminRole";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { VideoThumb } from "@/components/VideoThumb";
import { VideoThumbnailUploader } from "@/components/VideoThumbnailUploader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { VideoUploadForm } from "@/components/admin/VideoUploadForm";
import { Upload as UploadIcon, Film } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/admin/videos")({
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
};

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


function VideosPage() {
  const { isAdmin } = useAdminRole();
  const [rows, setRows] = useState<Row[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Row>>>({});
  const [openId, setOpenId] = useState<string | null>(null);

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
  const [total, setTotal] = useState(0);
  const [listLoading, setListLoading] = useState(false);
  const [unassignedCount, setUnassignedCount] = useState(0);

  const allowedIds = (classes as any[]).map((c) => c.id);

  const buildQuery = (trash: boolean) => {
    let q = supabase
      .from("videos")
      .select(
        trash
          ? "id,title,description,status,source,vimeo_video_id,external_video_id,thumbnail_url,class_id,is_published,sort_order,allow_seek,max_playback_rate,rewatch_allow_seek,rewatch_max_playback_rate,completion_ratio,week_label,created_at,deleted_at"
          : "id,title,description,status,source,vimeo_video_id,external_video_id,thumbnail_url,class_id,is_published,sort_order,allow_seek,max_playback_rate,rewatch_allow_seek,rewatch_max_playback_rate,completion_ratio,week_label,created_at",
        { count: "exact" },
      );
    q = trash ? q.not("deleted_at", "is", null) : q.is("deleted_at", null);
    // 강사는 접근 가능한 수강반의 영상만 (DB에서 필터)
    if (!isAdmin) q = q.in("class_id", allowedIds.length > 0 ? allowedIds : ["00000000-0000-0000-0000-000000000000"]);
    if (classFilter !== "__all__") {
      q = classFilter === NO_CLASS ? q.is("class_id", null) : q.eq("class_id", classFilter);
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
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    setRows(((data as any[] | null) ?? []) as Row[]);
    setTotal(count ?? 0);
    setEdits({});
    setListLoading(false);
  };
  useEffect(() => { load(); }, [isAdmin, classes, page, search, classFilter]);
  useEffect(() => { setPage(1); }, [search, classFilter]);

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
    setTrashRows(((data as any[] | null) ?? []) as Row[]);
    setTrashTotal(count ?? 0);
    setTrashLoading(false);
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
      const res = await purgeItem({ data: { entity: "videos", id } });
      if (res.vimeoError) {
        toast.warning(`DB는 삭제되었으나 Vimeo 라이브러리 삭제에 실패했습니다: ${res.vimeoError}`);
      } else {
        toast.success("영구 삭제되었습니다.");
      }
      loadTrash();
    } catch (err: any) {
      toast.error(err?.message ?? "영구 삭제 실패");
    }
  };




  const patch = (id: string, p: Partial<Row>) =>
    setEdits((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...p } }));

  const value = <K extends keyof Row>(r: Row, k: K): Row[K] =>
    (edits[r.id]?.[k] as Row[K]) ?? r[k];


  const save = async (r: Row) => {
    const e = edits[r.id];
    if (!e) return;
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
                          {r.class_id && (
                            <>
                              {" · "}
                              {(classes as any[]).find((c) => c.id === r.class_id)?.name ?? "미지정"}
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
                  {rows.map((r) => (
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
                          </p>
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
                        <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
                          <DialogHeader>
                            <DialogTitle className="truncate">{r.title}</DialogTitle>
                            <DialogDescription>영상 설정을 편집합니다.</DialogDescription>
                          </DialogHeader>
                          <div className="space-y-4">
                            <div>
                              <label className="text-xs text-muted-foreground">제목</label>
                              <Input
                                value={value(r, "title") as string}
                                onChange={(e) => patch(r.id, { title: e.target.value })}
                                placeholder="영상 제목"
                                className="mt-1"
                              />
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
