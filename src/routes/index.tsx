import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Play, Film } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";

type Video = {
  id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  duration: number | null;
  created_at: string;
};

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "VimStream — 동영상 플랫폼" },
      { name: "description", content: "Vimeo로 안전하게 호스팅되는 큐레이션 동영상 플랫폼." },
      { property: "og:title", content: "VimStream — 동영상 플랫폼" },
      { property: "og:description", content: "Vimeo로 안전하게 호스팅되는 큐레이션 동영상 플랫폼." },
      { property: "og:type", content: "website" },
    ],
  }),
  component: Home,
});

function formatDuration(sec: number | null) {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function Home() {
  const [videos, setVideos] = useState<Video[] | null>(null);

  useEffect(() => {
    supabase
      .from("videos")
      .select("id,title,description,thumbnail_url,duration,vimeo_video_id,created_at")
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .then(({ data }) => setVideos(data ?? []));
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-10">
        <section className="mb-10">
          <h1 className="text-4xl font-bold tracking-tight">최신 영상</h1>
          <p className="mt-2 text-muted-foreground">
            엄선된 콘텐츠를 Vimeo 플레이어로 감상하세요.
          </p>
        </section>

        {videos === null && <p className="text-muted-foreground">불러오는 중...</p>}
        {videos && videos.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
              <Film className="h-10 w-10 text-muted-foreground" />
              <p className="text-lg font-medium">아직 등록된 영상이 없습니다.</p>
              <p className="text-sm text-muted-foreground">
                관리자로 로그인 후 <code>/admin</code> 에서 영상을 업로드하세요.
              </p>
              <Button asChild variant="outline">
                <Link to="/admin">관리자 페이지로</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {videos?.map((v) => (
            <Link
              key={v.id}
              to="/video/$id"
              params={{ id: v.id }}
              className="group overflow-hidden rounded-xl border bg-card transition hover:shadow-lg"
            >
              <div className="relative aspect-video overflow-hidden bg-muted">
                {v.thumbnail_url ? (
                  <img
                    src={v.thumbnail_url}
                    alt={v.title}
                    className="h-full w-full object-cover transition group-hover:scale-105"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <Film className="h-10 w-10 text-muted-foreground" />
                  </div>
                )}
                <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/30">
                  <Play className="h-12 w-12 text-white opacity-0 transition group-hover:opacity-100" />
                </div>
                {v.duration ? (
                  <span className="absolute bottom-2 right-2 rounded bg-black/70 px-2 py-0.5 text-xs text-white">
                    {formatDuration(v.duration)}
                  </span>
                ) : null}
              </div>
              <div className="p-4">
                <h3 className="line-clamp-2 font-semibold">{v.title}</h3>
                {v.description && (
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    {v.description}
                  </p>
                )}
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
