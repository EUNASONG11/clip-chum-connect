import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import VimeoPlayer from "@vimeo/player";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/SiteHeader";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { getMyProgress, upsertMyProgress, listRecentlyWatched } from "@/lib/progress.functions";
import { CommentsSection } from "@/components/CommentsSection";
import { BookmarksPanel } from "@/components/BookmarksPanel";

type Video = {
  id: string;
  title: string;
  description: string | null;
  source: string;
  vimeo_video_id: string | null;
  external_video_id: string | null;
  player_embed_url: string | null;
  thumbnail_url: string | null;
  duration: number | null;
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

// YouTube IFrame API 로더 (한 번만)
let ytApiPromise: Promise<any> | null = null;
function loadYouTubeApi() {
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve) => {
    if ((window as any).YT?.Player) return resolve((window as any).YT);
    const prev = (window as any).onYouTubeIframeAPIReady;
    (window as any).onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve((window as any).YT);
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return ytApiPromise;
}

function formatDuration(sec: number | null) {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function VideoPage() {
  const { id } = Route.useParams();
  const [video, setVideo] = useState<Video | null | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const lastSentRef = useRef(0);
  const currentTimeRef = useRef(0);
  const seekRef = useRef<(sec: number) => void>(() => {});
  const [ratio, setRatio] = useState(0);
  const [completed, setCompleted] = useState(false);

  const { data: recents = [] } = useQuery({
    queryKey: ["recent", "watched"],
    queryFn: () => listRecentlyWatched({ data: { limit: 5 } }),
  });

  // 영상 정보 로드
  useEffect(() => {
    supabase
      .from("videos")
      .select("id,title,description,source,vimeo_video_id,external_video_id,player_embed_url,thumbnail_url,duration")
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => setVideo((data as Video | null) ?? null));
  }, [id]);

  // 저장된 진도 상태 초기화
  useEffect(() => {
    getMyProgress({ data: { videoId: id } }).then((p) => {
      if (p) {
        setRatio(Number(p.watched_ratio));
        setCompleted(p.is_completed);
      }
    }).catch(() => {});
  }, [id]);

  // 플레이어 초기화 + 이벤트 바인딩
  useEffect(() => {
    if (!video || !containerRef.current) return;
    let cleanup = () => {};

    const send = async (currentSeconds: number, duration: number | null, ended = false) => {
      const now = Date.now();
      if (!ended && now - lastSentRef.current < 4500) return;
      lastSentRef.current = now;
      try {
        const r = await upsertMyProgress({
          data: {
            videoId: id,
            currentSeconds: Math.floor(currentSeconds),
            duration: duration ? Math.floor(duration) : null,
            endedEvent: ended,
          },
        });
        setRatio(r.watched_ratio);
        if (r.is_completed) setCompleted(true);
      } catch {}
    };

    // 최초 이어보기 위치
    const resumeAtRef = { current: 0 as number };
    getMyProgress({ data: { videoId: id } })
      .then((p) => {
        if (p) resumeAtRef.current = p.current_seconds ?? 0;
      })
      .catch(() => {});

    if (video.source === "vimeo") {
      // Vimeo Player SDK
      const el = containerRef.current;
      el.innerHTML = "";
      const holder = document.createElement("div");
      holder.className = "absolute inset-0 h-full w-full";
      el.appendChild(holder);
      const player = new VimeoPlayer(holder, {
        id: Number(video.vimeo_video_id),
        responsive: true,
        title: false,
        byline: false,
        portrait: false,
      });
      let durationCached: number | null = video.duration ?? null;
      player.ready().then(async () => {
        try {
          durationCached = await player.getDuration();
          if (resumeAtRef.current > 5 && durationCached && resumeAtRef.current < durationCached - 3) {
            await player.setCurrentTime(resumeAtRef.current);
          }
        } catch {}
      });
      player.on("timeupdate", (d: any) => { currentTimeRef.current = d.seconds; send(d.seconds, durationCached); });
      player.on("pause", (d: any) => { currentTimeRef.current = d.seconds; send(d.seconds, durationCached); });
      player.on("ended", (d: any) => send(d.seconds ?? durationCached ?? 0, durationCached, true));
      seekRef.current = (sec: number) => { player.setCurrentTime(sec).catch(() => {}); player.play().catch(() => {}); };
      cleanup = () => {
        player.destroy().catch(() => {});
      };
    } else if (video.source === "youtube") {
      loadYouTubeApi().then((YT) => {
        if (!iframeRef.current) return;
        const player = new YT.Player(iframeRef.current, {
          events: {
            onReady: () => {
              try {
                const d = player.getDuration?.();
                if (resumeAtRef.current > 5 && d && resumeAtRef.current < d - 3) {
                  player.seekTo(resumeAtRef.current, true);
                }
              } catch {}
            },
            onStateChange: (e: any) => {
              const t = player.getCurrentTime?.() ?? 0;
              const d = player.getDuration?.() ?? null;
              currentTimeRef.current = t;
              if (e.data === 0) send(t, d, true);
              else if (e.data === 2) send(t, d);
            },
          },
        });
        seekRef.current = (sec: number) => { try { player.seekTo?.(sec, true); player.playVideo?.(); } catch {} };
        const iv = setInterval(() => {
          try {
            const state = player.getPlayerState?.();
            if (state === 1) {
              const t = player.getCurrentTime?.() ?? 0;
              const d = player.getDuration?.() ?? null;
              currentTimeRef.current = t;
              send(t, d);
            }
          } catch {}
        }, 5000);
        cleanup = () => {
          clearInterval(iv);
          try { player.destroy?.(); } catch {}
        };
      });
    }

    return () => cleanup();
  }, [video, id]);

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

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Link
          to="/"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> 홈으로
        </Link>

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div>
            <div className="overflow-hidden rounded-xl border bg-black">
              <div ref={containerRef} className="relative aspect-video">
                {video.source === "youtube" && (
                  <iframe
                    ref={iframeRef}
                    src={`https://www.youtube.com/embed/${video.external_video_id}?enablejsapi=1&origin=${encodeURIComponent(typeof window !== "undefined" ? window.location.origin : "")}`}
                    allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                    allowFullScreen
                    className="absolute inset-0 h-full w-full"
                    title={video.title}
                  />
                )}
              </div>
            </div>

            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>학습 진도 {Math.round(ratio * 100)}%</span>
                {completed && (
                  <span className="inline-flex items-center gap-1 text-green-600">
                    <CheckCircle2 className="h-4 w-4" /> 수강 완료
                  </span>
                )}
              </div>
              <Progress value={Math.round(ratio * 100)} />
            </div>

            <h1 className="mt-6 text-3xl font-bold">{video.title}</h1>
            {video.description && (
              <p className="mt-3 whitespace-pre-wrap text-muted-foreground">{video.description}</p>
            )}

            <CommentsSection videoId={id} />
          </div>

          <aside className="space-y-4">
            <BookmarksPanel
              videoId={id}
              getCurrentTime={() => currentTimeRef.current}
              onSeek={(sec) => seekRef.current?.(sec)}
            />

            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground">최근 본 영상</h2>
              {recents.length === 0 && (
                <p className="text-xs text-muted-foreground">아직 시청 기록이 없습니다.</p>
              )}
              <ul className="space-y-3">
                {recents.map((r: any) => (
                  <li key={r.video_id}>
                    <Link
                      to="/video/$id"
                      params={{ id: r.video_id }}
                      className="group flex gap-3 rounded-lg border p-2 transition hover:bg-muted"
                    >
                      <div className="h-16 w-24 flex-shrink-0 overflow-hidden rounded bg-muted">
                        {r.thumbnail_url && (
                          <img src={r.thumbnail_url} alt="" className="h-full w-full object-cover" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-sm font-medium group-hover:text-primary">
                          {r.title}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {Math.round(r.watched_ratio * 100)}%
                          {r.duration ? ` · ${formatDuration(r.duration)}` : ""}
                          {r.is_completed ? " · 완료" : ""}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
