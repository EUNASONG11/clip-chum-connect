import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/SiteHeader";
import { ArrowLeft } from "lucide-react";

type Video = {
  id: string;
  title: string;
  description: string | null;
  source: string;
  vimeo_video_id: string | null;
  external_video_id: string | null;
  player_embed_url: string | null;
  thumbnail_url: string | null;
};

export const Route = createFileRoute("/video/$id")({
  component: VideoPage,
  errorComponent: ({ error }) => (
    <div className="p-10 text-center text-destructive">{error.message}</div>
  ),
  notFoundComponent: () => (
    <div className="p-10 text-center">
      <p>영상을 찾을 수 없습니다.</p>
      <Link to="/" className="text-primary underline">홈으로</Link>
    </div>
  ),
});

function VideoPage() {
  const { id } = Route.useParams();
  const [video, setVideo] = useState<Video | null | undefined>(undefined);

  useEffect(() => {
    supabase
      .from("videos")
      .select("id,title,description,source,vimeo_video_id,external_video_id,player_embed_url,thumbnail_url")
      .eq("id", id)
      .eq("status", "ready")
      .maybeSingle()
      .then(({ data }) => setVideo((data as Video | null) ?? null));
  }, [id]);

  if (video === undefined) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <main className="mx-auto max-w-5xl px-4 py-10">
          <p className="text-muted-foreground">불러오는 중...</p>
        </main>
      </div>
    );
  }
  if (video === null) throw notFound();

  const vimeoSrc = video.player_embed_url
    ? `${video.player_embed_url}${video.player_embed_url.includes("?") ? "&" : "?"}title=0&byline=0&portrait=0`
    : `https://player.vimeo.com/video/${video.vimeo_video_id}?title=0&byline=0&portrait=0`;
  const src =
    video.source === "youtube"
      ? `https://www.youtube.com/embed/${video.external_video_id}`
      : vimeoSrc;

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Link
          to="/"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> 목록으로
        </Link>
        <div className="overflow-hidden rounded-xl border bg-black">
          <div className="relative aspect-video">
            <iframe
              src={src}
              allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
              allowFullScreen
              className="absolute inset-0 h-full w-full"
              title={video.title}
            />
          </div>
        </div>
        <h1 className="mt-6 text-3xl font-bold">{video.title}</h1>
        {video.description && (
          <p className="mt-3 whitespace-pre-wrap text-muted-foreground">{video.description}</p>
        )}
      </main>
    </div>
  );
}
