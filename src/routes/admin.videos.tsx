import { createFileRoute, useBlocker } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Trash2, RefreshCw, Save, Settings2 } from "lucide-react";
import { deleteVideo, refreshVideoStatus } from "@/lib/vimeo.functions";
import { listClasses, updateVideo } from "@/lib/classes.functions";
import { useAdminRole, RoleGate } from "@/components/AdminRole";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { VideoThumb } from "@/components/VideoThumb";
import { VideoThumbnailUploader } from "@/components/VideoThumbnailUploader";

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
    condition: hasUnsavedChanges,
    blockerFn: () => window.confirm("변경사항이 저장되지 않았습니다. 페이지를 나가시겠습니까?"),
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

  const { data: classes = [] } = useQuery({
    queryKey: ["admin", "classes"],
    queryFn: () => listClasses(),
  });

  const load = async () => {
    const { data } = await supabase
      .from("videos")
      .select("id,title,status,source,vimeo_video_id,external_video_id,thumbnail_url,class_id,is_published,sort_order,allow_seek,max_playback_rate,completion_ratio,created_at")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });
    let list = (data as Row[] | null) ?? [];
    if (!isAdmin) {
      const allowed = new Set((classes as any[]).map((c) => c.id));
      list = list.filter((r) => r.class_id && allowed.has(r.class_id));
    }
    setRows(list);
    setEdits({});
  };
  useEffect(() => { load(); }, [isAdmin, classes]);

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
    if (!confirm("삭제하시겠습니까? Vimeo 영상은 Vimeo에서도 삭제됩니다.")) return;
    try {
      await deleteVideo({ data: { id } });
      toast.success("삭제되었습니다.");
      load();
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
      <Card>
        <CardHeader>
          <CardTitle>등록된 영상 ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">아직 없습니다.</p>
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
                      <p className="truncate font-medium">{r.title}</p>
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
                    <DialogContent className="max-w-lg">
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
        </CardContent>
      </Card>
    </RoleGate>
  );
}
