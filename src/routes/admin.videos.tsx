import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Trash2, RefreshCw, Save } from "lucide-react";
import { deleteVideo, refreshVideoStatus } from "@/lib/vimeo.functions";
import { listClasses, updateVideo } from "@/lib/classes.functions";
import { AdminOnly } from "@/components/AdminRole";

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
  const [rows, setRows] = useState<Row[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Row>>>({});

  const { data: classes = [] } = useQuery({
    queryKey: ["admin", "classes"],
    queryFn: () => listClasses(),
  });

  const load = async () => {
    const { data } = await supabase
      .from("videos")
      .select("id,title,status,source,vimeo_video_id,external_video_id,thumbnail_url,class_id,is_published,sort_order,allow_seek,max_playback_rate,created_at")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });
    setRows((data as Row[] | null) ?? []);
    setEdits({});
  };
  useEffect(() => { load(); }, []);

  const patch = (id: string, p: Partial<Row>) =>
    setEdits((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...p } }));

  const value = <K extends keyof Row>(r: Row, k: K): Row[K] =>
    (edits[r.id]?.[k] as Row[K]) ?? r[k];

  const dirty = (id: string) => !!edits[id] && Object.keys(edits[id]!).length > 0;

  const save = async (r: Row) => {
    const e = edits[r.id];
    if (!e) return;
    try {
      await updateVideo({
        data: {
          id: r.id,
          class_id: e.class_id === undefined ? undefined : e.class_id,
          is_published: e.is_published,
          sort_order: e.sort_order,
          allow_seek: e.allow_seek,
          max_playback_rate: e.max_playback_rate,
        },
      });
      toast.success("저장되었습니다.");
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
                <li key={r.id} className="space-y-3 py-4">
                  <div className="flex items-center gap-4">
                    <div className="h-14 w-24 flex-shrink-0 overflow-hidden rounded bg-muted">
                      {r.thumbnail_url && (
                        <img src={r.thumbnail_url} alt="" className="h-full w-full object-cover" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{r.title}</p>
                      <p className="text-xs text-muted-foreground">
                        <span className="uppercase">{r.source}</span>
                        {" · "}상태:{" "}
                        <span className={r.status === "ready" ? "text-green-600" : "text-amber-600"}>
                          {statusLabel(r.status)}
                        </span>
                      </p>
                    </div>
                    {r.source === "vimeo" && (
                      <Button size="sm" variant="ghost" onClick={() => refresh(r.id)} title="상태 새로고침">
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => remove(r.id)} title="삭제">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_100px_auto_auto]">
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
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={value(r, "is_published") as boolean}
                        onCheckedChange={(v) => patch(r.id, { is_published: v })}
                      />
                      <span className="text-xs">공개</span>
                    </div>
                    <Button size="sm" disabled={!dirty(r.id)} onClick={() => save(r)}>
                      <Save className="mr-1 h-4 w-4" /> 저장
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[auto_140px]">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={value(r, "allow_seek") as boolean}
                        onCheckedChange={(v) => patch(r.id, { allow_seek: v })}
                      />
                      <span className="text-xs">건너뛰기 허용</span>
                    </div>
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
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </AdminOnly>
  );
}
