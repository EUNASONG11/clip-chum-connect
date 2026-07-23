import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import VimeoPlayer from "@vimeo/player";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/SiteHeader";
import { ArrowLeft, CheckCircle2, Maximize2 } from "lucide-react";
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

function getVimeoEmbedUrl(video: Video) {
  if (!video.player_embed_url) return null;
  const separator = video.player_embed_url.includes("?") ? "&" : "?";
  return `${video.player_embed_url}${separator}title=0&byline=0&portrait=0&vimeo_logo=0&responsive=1`;
}

async function requestElementFullscreen(element: Element | null) {
  if (!element) return false;
  const target = element as Element & {
    webkitRequestFullscreen?: () => Promise<void> | void;
    mozRequestFullScreen?: () => Promise<void> | void;
    msRequestFullscreen?: () => Promise<void> | void;
  };
  const request =
    target.requestFullscreen ??
    target.webkitRequestFullscreen ??
    target.mozRequestFullScreen ??
    target.msRequestFullscreen;

  if (!request) return false;

  try {
    await request.call(target);
    return true;
  } catch {
    return false;
  }
}

function VideoPage() {
  const { id } = Route.useParams();
  const [video, setVideo] = useState<Video | null | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const lastSentRef = useRef(0);
  const currentTimeRef = useRef(0);
  const seekRef = useRef<(sec: number) => void>(() => {});
  const fullscreenRef = useRef<() => void>(() => {});
  const [ratio, setRatio] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [isPlayerExpanded, setIsPlayerExpanded] = useState(false);

  useEffect(() => {
    if (!isPlayerExpanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const orientation = (screen as any).orientation;
    if (orientation?.lock) {
      orientation.lock("landscape").catch(() => {});
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsPlayerExpanded(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      if (orientation?.unlock) {
        try { orientation.unlock(); } catch {}
      }
    };
  }, [isPlayerExpanded]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setIsAuthed(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setIsAuthed(!!s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const { data: recents = [] } = useQuery({
    queryKey: ["recent", "watched"],
    queryFn: () => listRecentlyWatched({ data: { limit: 5 } }),
    enabled: isAuthed,
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
  const progressRef = useRef<{ current_seconds: number; max_seconds: number; watched_ratio: number; is_completed: boolean } | null>(null);
  useEffect(() => {
    if (!isAuthed) return;
    getMyProgress({ data: { videoId: id } }).then((p) => {
      if (p) {
        progressRef.current = {
          current_seconds: p.current_seconds ?? 0,
          max_seconds: p.max_seconds ?? p.current_seconds ?? 0,
          watched_ratio: Number(p.watched_ratio),
          is_completed: p.is_completed,
        };
        setRatio(Number(p.watched_ratio));
        setCompleted(p.is_completed);
      }
    }).catch(() => {});
  }, [id, isAuthed]);


  // 플레이어 초기화 + 이벤트 바인딩
  useEffect(() => {
    if (!video || !containerRef.current) return;
    let cleanup = () => {};

    const send = async (currentSeconds: number, duration: number | null, ended = false) => {
      if (!isAuthed) return;
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
    if (isAuthed) {
      getMyProgress({ data: { videoId: id } })
        .then((p) => {
          if (p) resumeAtRef.current = p.current_seconds ?? 0;
        })
        .catch(() => {});
    }


    if (video.source === "vimeo") {
      // Vimeo Player SDK
      const el = containerRef.current;
      el.innerHTML = "";
      const embedUrl = getVimeoEmbedUrl(video);
      const player = embedUrl
        ? (() => {
            const iframe = document.createElement("iframe");
            iframe.src = embedUrl;
            iframe.allow = "autoplay; fullscreen; picture-in-picture; encrypted-media";
            iframe.allowFullscreen = true;
            iframe.title = video.title;
            iframe.className = "absolute inset-0 h-full w-full";
            el.appendChild(iframe);
            return new VimeoPlayer(iframe);
          })()
        : new VimeoPlayer(el, {
            id: Number(video.vimeo_video_id),
            responsive: true,
            title: false,
            byline: false,
            portrait: false,
            vimeo_logo: false,
          });
      let durationCached: number | null = video.duration ?? null;
      const maxAllowedRef = { current: 0 };
      player.ready().then(async () => {
        try {
          durationCached = await player.getDuration();
          if (resumeAtRef.current > 5 && durationCached && resumeAtRef.current < durationCached - 3) {
            await player.setCurrentTime(resumeAtRef.current);
            maxAllowedRef.current = resumeAtRef.current;
          }
        } catch {}
      });
      player.on("timeupdate", (d: any) => {
        currentTimeRef.current = d.seconds;
        if (d.seconds > maxAllowedRef.current) maxAllowedRef.current = d.seconds;
        send(d.seconds, durationCached);
      });
      player.on("seeked", (d: any) => {
        // 앞으로 건너뛰기 방지: 최대 시청 지점 + 2초 초과 시 되돌림
        if (d.seconds > maxAllowedRef.current + 2) {
          player.setCurrentTime(maxAllowedRef.current).catch(() => {});
        }
      });
      player.on("pause", (d: any) => { currentTimeRef.current = d.seconds; send(d.seconds, durationCached); });
      player.on("ended", (d: any) => send(d.seconds ?? durationCached ?? 0, durationCached, true));
      seekRef.current = (sec: number) => {
        // 이어보기/최근 시청 클릭은 허용 (maxAllowed 갱신)
        if (sec > maxAllowedRef.current) maxAllowedRef.current = sec;
        player.setCurrentTime(sec).catch(() => {});
        player.play().catch(() => {});
      };
      fullscreenRef.current = () => {
        void (async () => {
          try {
            if ((player as any).requestFullscreen) {
              await (player as any).requestFullscreen();
              return;
            }
          } catch {}

          const iframe = containerRef.current?.querySelector("iframe") ?? null;
          const opened =
            (await requestElementFullscreen(iframe)) ||
            (await requestElementFullscreen(containerRef.current));
          if (!opened) setIsPlayerExpanded(true);
        })();
      };
      cleanup = () => {
        player.destroy().catch(() => {});
      };
    } else if (video.source === "youtube") {
      loadYouTubeApi().then((YT) => {
        if (!iframeRef.current) return;
        const maxAllowedRef = { current: resumeAtRef.current };
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
              // 앞으로 건너뛰기 방지
              if (t > maxAllowedRef.current + 2) {
                try { player.seekTo?.(maxAllowedRef.current, true); } catch {}
                return;
              }
              if (t > maxAllowedRef.current) maxAllowedRef.current = t;
              if (e.data === 0) send(t, d, true);
              else if (e.data === 2) send(t, d);
            },
          },
        });
        seekRef.current = (sec: number) => {
          if (sec > maxAllowedRef.current) maxAllowedRef.current = sec;
          try { player.seekTo?.(sec, true); player.playVideo?.(); } catch {}
        };
        fullscreenRef.current = () => {
          void (async () => {
            const opened =
              (await requestElementFullscreen(iframeRef.current)) ||
              (await requestElementFullscreen(containerRef.current));
            if (!opened) setIsPlayerExpanded(true);
          })();
        };
        const iv = setInterval(() => {
          try {
            const state = player.getPlayerState?.();
            if (state === 1) {
              const t = player.getCurrentTime?.() ?? 0;
              const d = player.getDuration?.() ?? null;
              currentTimeRef.current = t;
              if (t > maxAllowedRef.current + 2) {
                try { player.seekTo?.(maxAllowedRef.current, true); } catch {}
              } else {
                if (t > maxAllowedRef.current) maxAllowedRef.current = t;
                send(t, d);
              }
            }
          } catch {}
        }, 3000);
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
            <div
              className={
                isPlayerExpanded
                  ? "fixed inset-0 z-[100] flex items-center justify-center bg-black"
                  : "relative overflow-hidden rounded-xl border bg-black"
              }
            >
              <div ref={containerRef} className={isPlayerExpanded ? "relative w-full aspect-video" : "relative aspect-video"}>
                {video.source === "youtube" && (
                  <iframe
                    ref={iframeRef}
                    src={`https://www.youtube.com/embed/${video.external_video_id}?enablejsapi=1&playsinline=1&origin=${encodeURIComponent(typeof window !== "undefined" ? window.location.origin : "")}`}
                    allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                    allowFullScreen
                    className="absolute inset-0 h-full w-full"
                    title={video.title}
                  />
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  if (isPlayerExpanded) setIsPlayerExpanded(false);
                  else setIsPlayerExpanded(true);
                }}
                className="absolute bottom-2 right-2 z-[110] inline-flex items-center gap-1 rounded-md bg-black/70 px-3 py-1.5 text-xs text-white shadow-lg backdrop-blur hover:bg-black/80 md:hidden"
                aria-label={isPlayerExpanded ? "전체화면 닫기" : "전체화면"}
              >
                <Maximize2 className="h-3.5 w-3.5" /> {isPlayerExpanded ? "닫기" : "전체화면"}
              </button>
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
