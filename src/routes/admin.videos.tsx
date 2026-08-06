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
import { restoreItem, purgeItem } from "@/lib/trash.functions";
import { useAdminRole, RoleGate } from "@/components/AdminRole";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { VideoThumb } from "@/components/VideoThumb";
import { VideoThumbnailUploader } from "@/components/VideoThumbnailUploader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { VideoUploadForm } from "@/components/admin/VideoUploadForm";
import { Upload as UploadIcon, Film } from "lucide-react";

export const Route = createFileRoute("/admin/videos")({
  component: VideosPage,
});

type Row = {
  id: string;
  title: string;
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

  const allowedIds = (classes as any[]).map((c) => c.id);

  const buildQuery = (trash: boolean) => {
    let q = supabase
      .from("videos")
      .select(
        trash
          ? "id,title,status,source,vimeo_video_id,external_video_id,thumbnail_url,class_id,is_published,sort_order,allow_seek,max_playback_rate,rewatch_allow_seek,rewatch_max_playback_rate,completion_ratio,created_at,deleted_at"
          : "id,title,status,source,vimeo_video_id,external_video_id,thumbnail_url,class_id,is_published,sort_order,allow_seek,max_playback_rate,rewatch_allow_seek,rewatch_max_playback_rate,completion_ratio,created_at",
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
          class_id: e.class_id === undefined ? undefined : e.class_id,
          is_published: e.is_published,
          sort_order: e.sort_order,
          allow_seek: e.allow_seek,
          max_playback_rate: e.max_playback_rate,
          rewatch_allow_seek: e.rewatch_allow_seek,
          rewatch_max_playback_rate: e.rewatch_max_playback_rate,
          completion_ratio: e.completion_ratio,
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
  return (<RoleGate><div>BISECT_OK {total}</div>
  );
}
