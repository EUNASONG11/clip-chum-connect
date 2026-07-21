import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Trash2, RefreshCw } from "lucide-react";
import { deleteVideo, refreshVideoStatus } from "@/lib/vimeo.functions";

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
  created_at: string;
};

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

function statusLabel(status: string) {
  return statusMap[status] ?? status;
}

function VideosPage() {
  const [rows, setRows] = useState<Row[]>([]);

  const load = async () => {
    const { data } = await supabase
      .from("videos")
      .select("id,title,status,source,vimeo_video_id,external_video_id,thumbnail_url,created_at")
      .order("created_at", { ascending: false });
    setRows((data as Row[] | null) ?? []);
  };

  useEffect(() => { load(); }, []);

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
      toast.success(`상태: ${r.status}`);
      load();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
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
              <li key={r.id} className="flex items-center gap-4 py-3">
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
                    {r.source === "vimeo" && r.vimeo_video_id ? ` · Vimeo ID: ${r.vimeo_video_id}` : ""}
                    {r.source === "youtube" && r.external_video_id ? ` · YT ID: ${r.external_video_id}` : ""}
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
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
