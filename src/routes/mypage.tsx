import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/SiteHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { GraduationCap, LogOut, Play, User } from "lucide-react";
import { getMyDisplayName, getMyRole } from "@/lib/vimeo.functions";
import { listClasses, listMyRecentProgress } from "@/lib/classes.functions";
import { ClassThumb } from "@/components/ClassThumb";
import { VideoThumb } from "@/components/VideoThumb";


export const Route = createFileRoute("/mypage")({
  head: () => ({
    meta: [
      { title: "마이페이지 — 이재식국어" },
      { name: "description", content: "내 정보와 최근 학습 진도를 확인합니다." },
      { property: "og:title", content: "마이페이지 — 이재식국어" },
      { property: "og:description", content: "내 정보와 최근 학습 진도를 확인합니다." },
    ],
  }),
  component: MyPage,
});

function MyPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        navigate({ to: "/login", replace: true });
        return;
      }
      setEmail(data.session.user.email ?? null);
      setReady(true);
    })();
  }, [navigate]);

  const { data: me } = useQuery({
    queryKey: ["mypage", "me"],
    queryFn: async () => {
      const [n, r] = await Promise.all([getMyDisplayName(), getMyRole()]);
      return { name: n.name, isAdmin: r.isAdmin };
    },
    enabled: ready,
  });
  const { data: classes = [] } = useQuery({
    queryKey: ["mypage", "classes"],
    queryFn: () => listClasses(),
    enabled: ready,
  });
  const { data: progress = [] } = useQuery({
    queryKey: ["mypage", "progress"],
    queryFn: () => listMyRecentProgress(),
    enabled: ready,
  });

  // 썸네일 서명 주소를 한 번에 묶어 미리 발급받아 표시 속도를 높인다.
  useEffect(() => {
    const classPaths = (classes as any[])
      .map((c) => extractStoragePath("class-thumbnails", c.thumbnail_url ?? ""))
      .filter((p): p is string => !!p);
    if (classPaths.length > 0) prefetchSignedThumbUrls("class-thumbnails", classPaths);
  }, [classes]);
  useEffect(() => {
    const videoPaths = (progress as any[])
      .map((p) => extractStoragePath("video-thumbnails", p.videos?.thumbnail_url ?? ""))
      .filter((p): p is string => !!p);
    if (videoPaths.length > 0) prefetchSignedThumbUrls("video-thumbnails", videoPaths);
  }, [progress]);

  if (!ready) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <p className="p-10 text-muted-foreground">불러오는 중...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24 md:pb-0">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-8 space-y-6">
        <h1 className="text-3xl font-bold">마이페이지</h1>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" /> 내 정보
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>
              <span className="text-muted-foreground">이름</span>
              <p className="text-base font-medium">{me?.name ?? "-"}</p>
            </div>
            {email && !email.endsWith("@mirror.local") && (
              <div>
                <span className="text-muted-foreground">이메일</span>
                <p className="text-base">{email}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GraduationCap className="h-5 w-5" /> 내 클래스 ({classes.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {classes.length === 0 ? (
              <p className="text-sm text-muted-foreground">배정된 수강반이 없습니다.</p>
            ) : (
              <ul className="divide-y">
                {classes.map((c: any) => (
                  <li key={c.id}>
                    <Link
                      to="/class/$id"
                      params={{ id: c.id }}
                      className="flex items-center gap-3 py-3 hover:bg-muted/50"
                    >
                      <div className="h-12 w-20 flex-shrink-0 overflow-hidden rounded bg-muted">
                        {c.thumbnail_url && (
                          <ClassThumb src={c.thumbnail_url} className="h-full w-full object-cover" />
                        )}
                      </div>

                      <span className="flex-1 truncate font-medium">{c.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Play className="h-5 w-5" /> 최근 학습
            </CardTitle>
          </CardHeader>
          <CardContent>
            {progress.length === 0 ? (
              <p className="text-sm text-muted-foreground">아직 학습 기록이 없습니다.</p>
            ) : (
              <ul className="space-y-2">
                {progress.map((p: any) => {
                  const v = p.videos;
                  if (!v) return null;
                  const pct = Math.min(100, Math.ceil((p.watched_ratio ?? 0) * 100));
                  return (
                    <li key={p.video_id}>
                      <Link
                        to="/video/$id"
                        params={{ id: v.id }}
                        className="flex items-center gap-3 rounded-lg p-2 hover:bg-muted/50"
                      >
                        <div className="h-12 w-20 flex-shrink-0 overflow-hidden rounded bg-muted">
                          {v.thumbnail_url && (
                            <VideoThumb src={v.thumbnail_url} alt="" className="h-full w-full object-cover" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{v.title}</p>
                          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full bg-primary transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {p.is_completed ? "완료" : `${pct}% 시청`}
                          </p>
                        </div>
                      </Link>
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
