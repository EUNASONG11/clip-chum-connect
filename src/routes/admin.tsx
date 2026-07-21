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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Trash2, RefreshCw, Upload as UploadIcon, ShieldCheck, Youtube, UserPlus, UserMinus } from "lucide-react";
import {
  createVimeoUpload,
  finalizeVideo,
  deleteVideo,
  refreshVideoStatus,
  getMyRole,
  claimAdminIfNone,
  addYoutubeVideo,
  ensureStudentRole,
  listUsers,
  grantAdminByEmail,
  revokeAdmin,
} from "@/lib/vimeo.functions";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "관리자 — VimStream" }] }),
  component: AdminPage,
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

function AdminPage() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);

  // Vimeo 업로드 상태
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // YouTube 링크 상태
  const [ytUrl, setYtUrl] = useState("");
  const [ytTitle, setYtTitle] = useState("");
  const [ytDesc, setYtDesc] = useState("");
  const [ytSaving, setYtSaving] = useState(false);

  // 사용자 관리 상태
  type UserRow = { id: string; email: string; created_at: string; roles: string[] };
  const [users, setUsers] = useState<UserRow[]>([]);
  const [grantEmail, setGrantEmail] = useState("");
  const [granting, setGranting] = useState(false);

  const load = async () => {
    const { data } = await supabase
      .from("videos")
      .select("id,title,status,source,vimeo_video_id,external_video_id,thumbnail_url,created_at")
      .order("created_at", { ascending: false });
    setRows((data as Row[] | null) ?? []);
  };

  const loadUsers = async () => {
    try {
      const u = await listUsers();
      setUsers(u as UserRow[]);
    } catch (err: any) {
      toast.error(err.message ?? "사용자 목록을 불러올 수 없습니다.");
    }
  };

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        navigate({ to: "/auth" });
        return;
      }
      try {
        try { await ensureStudentRole(); } catch {}
        const me = await getMyRole();
        if (!me.isAdmin) {
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
        loadUsers();
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

  const addYt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ytUrl.trim()) return toast.error("YouTube 링크를 입력하세요.");
    if (!ytTitle.trim()) return toast.error("제목을 입력하세요.");
    setYtSaving(true);
    try {
      await addYoutubeVideo({
        data: { url: ytUrl.trim(), title: ytTitle, description: ytDesc || null },
      });
      toast.success("YouTube 영상이 추가되었습니다.");
      setYtUrl("");
      setYtTitle("");
      setYtDesc("");
      load();
    } catch (err: any) {
      toast.error(err.message ?? "추가 실패");
    } finally {
      setYtSaving(false);
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
      toast.success(`상태: ${r.status}`);
      load();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const grantAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!grantEmail.trim()) return;
    setGranting(true);
    try {
      await grantAdminByEmail({ data: { email: grantEmail.trim() } });
      toast.success("관리자 권한을 부여했습니다.");
      setGrantEmail("");
      loadUsers();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setGranting(false);
    }
  };

  const removeAdmin = async (userId: string, email: string) => {
    if (!confirm(`${email} 의 관리자 권한을 회수하시겠습니까?`)) return;
    try {
      await revokeAdmin({ data: { userId } });
      toast.success("관리자 권한을 회수했습니다.");
      loadUsers();
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
            <CardTitle>새 영상 추가</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="vimeo" className="w-full">
              <TabsList>
                <TabsTrigger value="vimeo" className="gap-2">
                  <UploadIcon className="h-4 w-4" /> 파일 업로드 (Vimeo)
                </TabsTrigger>
                <TabsTrigger value="youtube" className="gap-2">
                  <Youtube className="h-4 w-4" /> YouTube 링크
                </TabsTrigger>
              </TabsList>

              <TabsContent value="vimeo" className="pt-4">
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
              </TabsContent>

              <TabsContent value="youtube" className="pt-4">
                <form onSubmit={addYt} className="space-y-4">
                  <div>
                    <Label htmlFor="yt-url">YouTube 링크</Label>
                    <Input
                      id="yt-url"
                      placeholder="https://www.youtube.com/watch?v=..."
                      value={ytUrl}
                      onChange={(e) => setYtUrl(e.target.value)}
                      required
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      youtube.com/watch, youtu.be, /embed, /shorts 링크 지원
                    </p>
                  </div>
                  <div>
                    <Label htmlFor="yt-title">제목</Label>
                    <Input id="yt-title" value={ytTitle} onChange={(e) => setYtTitle(e.target.value)} required />
                  </div>
                  <div>
                    <Label htmlFor="yt-desc">설명</Label>
                    <Textarea id="yt-desc" rows={3} value={ytDesc} onChange={(e) => setYtDesc(e.target.value)} />
                  </div>
                  <Button type="submit" disabled={ytSaving}>
                    {ytSaving ? "추가 중..." : "추가"}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
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

        <Card>
          <CardHeader>
            <CardTitle>사용자 관리 ({users.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <form onSubmit={grantAdmin} className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="email"
                placeholder="관리자로 지정할 이메일"
                value={grantEmail}
                onChange={(e) => setGrantEmail(e.target.value)}
                required
              />
              <Button type="submit" disabled={granting} className="gap-1">
                <UserPlus className="h-4 w-4" />
                {granting ? "처리 중..." : "관리자 부여"}
              </Button>
            </form>
            {users.length === 0 ? (
              <p className="text-sm text-muted-foreground">사용자가 없습니다.</p>
            ) : (
              <ul className="divide-y">
                {users.map((u) => {
                  const admin = u.roles.includes("admin");
                  return (
                    <li key={u.id} className="flex items-center gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{u.email || "(이메일 없음)"}</p>
                        <p className="text-xs text-muted-foreground">
                          역할:{" "}
                          <span className={admin ? "text-primary font-medium" : ""}>
                            {admin ? "관리자" : "학생"}
                          </span>
                        </p>
                      </div>
                      {admin ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1"
                          onClick={() => removeAdmin(u.id, u.email)}
                        >
                          <UserMinus className="h-4 w-4" /> 관리자 회수
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-1"
                          onClick={async () => {
                            try {
                              await grantAdminByEmail({ data: { email: u.email } });
                              toast.success("관리자 권한을 부여했습니다.");
                              loadUsers();
                            } catch (err: any) {
                              toast.error(err.message);
                            }
                          }}
                        >
                          <UserPlus className="h-4 w-4" /> 관리자 지정
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
