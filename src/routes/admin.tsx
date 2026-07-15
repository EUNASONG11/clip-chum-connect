import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import * as tus from "tus-js-client";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Trash2, RefreshCw, Upload as UploadIcon, ShieldCheck } from "lucide-react";
import {
  createVimeoUpload,
  finalizeVideo,
  deleteVideo,
  refreshVideoStatus,
  getMyRole,
  claimAdminIfNone,
} from "@/lib/vimeo.functions";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "관리자 — VimStream" }] }),
  component: AdminPage,
});

type Row = {
  id: string;
  title: string;
  status: string;
  vimeo_video_id: string;
  thumbnail_url: string | null;
  created_at: string;
};

function AdminPage() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const { data } = await supabase
      .from("videos")
      .select("id,title,status,vimeo_video_id,thumbnail_url,created_at")
      .order("created_at", { ascending: false });
    setRows(data ?? []);
  };

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        navigate({ to: "/auth" });
        return;
      }
      try {
        const me = await getMyRole();
        if (!me.isAdmin) {
          // 최초 부트스트랩: admin 이 아무도 없으면 나를 admin 으로
          const c = await claimAdminIfNone();
          if (c.claimed) {
            toast.success("첫 관리자로 등록되었습니다.");
            setIsAdmin(true);
          } else {
            setIsAdmin(false);
          }
        } else {
          setIsAdmin(true);
        }
      } finally {
        setChecking(false);
        load();
      }
    })();
  }, [navigate]);

  const upload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return toast.error("파일을 선택하세요.");
    if (!title.trim()) return toast.error("제목을 입력하세요.");

    setUploading(true);
    setProgress(0);
    try {
      const session = await createVimeoUpload({
        data: { name: title, description: description || null, size: file.size },
      });

      await new Promise<void>((resolve, reject) => {
        const upload = new tus.Upload(file, {
          endpoint: session.uploadLink,
          uploadUrl: session.uploadLink,
          retryDelays: [0, 1000, 3000, 5000],
          chunkSize: 128 * 1024 * 1024,
          metadata: { filename: file.name, filetype: file.type },
          headers: {},
          onError: (err) => reject(err),
          onProgress: (sent, total) => setProgress(Math.round((sent / total) * 100)),
          onSuccess: () => resolve(),
        });
        upload.start();
      });

      await finalizeVideo({
        data: { uri: session.uri, title, description: description || null },
      });

      toast.success("업로드 완료! Vimeo 처리 후 자동으로 재생 가능합니다.");
      setTitle("");
      setDescription("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      setProgress(null);
      load();
    } catch (err: any) {
      toast.error(err.message ?? "업로드 실패");
    } finally {
      setUploading(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("삭제하시겠습니까? Vimeo 에서도 삭제됩니다.")) return;
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

  if (checking) {
    return (
      <div className="min-h-screen">
        <SiteHeader />
        <p className="p-10 text-muted-foreground">확인 중...</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen">
        <SiteHeader />
        <div className="mx-auto max-w-md p-10 text-center">
          <ShieldCheck className="mx-auto h-10 w-10 text-muted-foreground" />
          <h2 className="mt-4 text-xl font-semibold">관리자 권한이 없습니다.</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            관리자에게 권한 부여를 요청하세요.
          </p>
          <Button asChild variant="outline" className="mt-4">
            <Link to="/">홈으로</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-8 space-y-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UploadIcon className="h-5 w-5" /> 새 영상 업로드
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={upload} className="space-y-4">
              <div>
                <Label htmlFor="title">제목</Label>
                <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="desc">설명</Label>
                <Textarea id="desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="file">영상 파일</Label>
                <Input
                  id="file"
                  type="file"
                  accept="video/*"
                  ref={fileRef}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  required
                />
                {file && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB
                  </p>
                )}
              </div>
              {progress !== null && (
                <div>
                  <Progress value={progress} />
                  <p className="mt-1 text-xs text-muted-foreground">{progress}%</p>
                </div>
              )}
              <Button type="submit" disabled={uploading}>
                {uploading ? "업로드 중..." : "업로드"}
              </Button>
            </form>
          </CardContent>
        </Card>

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
                        상태: <span className={r.status === "ready" ? "text-green-600" : "text-amber-600"}>{r.status}</span>
                        {" · "}Vimeo ID: {r.vimeo_video_id}
                      </p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => refresh(r.id)} title="상태 새로고침">
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(r.id)} title="삭제">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
