import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import VimeoPlayer from "@vimeo/player";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/SiteHeader";
import { ArrowLeft, CheckCircle2, Maximize2, Minimize2, Pause, Play } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { getMyProgress, upsertMyProgress, listRecentlyWatched } from "@/lib/progress.functions";
import { CommentsSection } from "@/components/CommentsSection";
import { BookmarksPanel } from "@/components/BookmarksPanel";
import { VideoThumb } from "@/components/VideoThumb";
import { cn } from "@/lib/utils";

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
  allow_seek: boolean;
  max_playback_rate: number;
  rewatch_allow_seek: boolean | null;
  rewatch_max_playback_rate: number | null;
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
  return `${video.player_embed_url}${separator}title=0&byline=0&portrait=0&vimeo_logo=0&responsive=1&fullscreen=0`;
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
  const durationRef = useRef<number | null>(null);
  const seekRef = useRef<(sec: number) => void>(() => {});
  const fullscreenRef = useRef<() => void>(() => {});
  const playerRef = useRef<any>(null);
  const isPlayingRef = useRef(false);
  const [ratio, setRatio] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [progressLoaded, setProgressLoaded] = useState(false);
  const [initialCompleted, setInitialCompleted] = useState(false);
  const [isPlayerExpanded, setIsPlayerExpanded] = useState(false);
  const [showFsControls, setShowFsControls] = useState(true);
  const fsControlsTimerRef = useRef<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const revealFsControls = () => {
    setShowFsControls(true);
    if (fsControlsTimerRef.current) window.clearTimeout(fsControlsTimerRef.current);
    // 재생 화면(iframe)이 클릭을 가로채므로 컨트롤은 계속 노출합니다.
  };

  const togglePlayPause = async () => {
    const player = playerRef.current;
    if (!player) return;
    try {
      if (video?.source === "vimeo") {
        const paused = await player.getPaused();
        if (paused) { await player.play(); setIsPlaying(true); }
        else { await player.pause(); setIsPlaying(false); }
      } else if (video?.source === "youtube") {
        const state = player.getPlayerState?.();
        if (state === 1) { player.pauseVideo?.(); setIsPlaying(false); }
        else { player.playVideo?.(); setIsPlaying(true); }
      }
    } catch {}
  };

  useEffect(() => {
    if (!isPlayerExpanded) {
      setShowFsControls(true);
      return;
    }
    setShowFsControls(true);
    if (fsControlsTimerRef.current) window.clearTimeout(fsControlsTimerRef.current);
    // 재생 화면(iframe)이 클릭을 가로채므로 컨트롤은 계속 노출합니다.

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
      if (fsControlsTimerRef.current) window.clearTimeout(fsControlsTimerRef.current);
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
      .select("id,title,description,source,vimeo_video_id,external_video_id,player_embed_url,thumbnail_url,duration,allow_seek,max_playback_rate,rewatch_allow_seek,rewatch_max_playback_rate")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle()
      .then(({ data }) => setVideo((data as Video | null) ?? null));
  }, [id]);

  // 저장된 진도 상태 초기화
  const progressRef = useRef<{ current_seconds: number; max_seconds: number; watched_ratio: number; is_completed: boolean } | null>(null);
  useEffect(() => {
    setProgressLoaded(false);
    setInitialCompleted(false);
    if (!isAuthed) {
      progressRef.current = null;
      setProgressLoaded(true);
      return;
    }
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
        setInitialCompleted(p.is_completed);
      } else {
        progressRef.current = null;
      }
      setProgressLoaded(true);
    }).catch(() => setProgressLoaded(true));
  }, [id, isAuthed]);



  // 플레이어 초기화 + 이벤트 바인딩
  useEffect(() => {
    if (!video || !containerRef.current) return;
    if (isAuthed && !progressLoaded) return;
    const effectiveAllowSeek = initialCompleted && video.rewatch_allow_seek !== null
      ? !!video.rewatch_allow_seek
      : !!video.allow_seek;
    const effectiveMaxRate = initialCompleted && video.rewatch_max_playback_rate !== null
      ? Number(video.rewatch_max_playback_rate)
      : Number(video.max_playback_rate ?? 2);
    let cleanup = () => {};

    const send = async (currentSeconds: number, duration: number | null, ended = false, force = false) => {
      if (!isAuthed) return;
      const now = Date.now();
      if (!force && !ended && now - lastSentRef.current < 4500) return;
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

    // 페이지 이탈/백그라운드 전환 직전에도 진도를 강제 저장
    const saveOnLeave = () => {
      const t = currentTimeRef.current;
      const d = durationRef.current;
      if (t > 0) send(t, d, false, true);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") saveOnLeave();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", saveOnLeave);
    const onBeforeUnload = () => {
      // beforeunload는 동기적이어야 하므로 sendBeacon 대신 visibilitychange/pagehide에 의존
      // 단, 이탈 직전 한 번 더 시도 (비동기 저장이 완료될 수도, 안 될 수도 있음)
      saveOnLeave();
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    // 최초 이어보기 위치 (current_seconds) 와 최대 시청 지점 (max_seconds) 분리
    const resumeAtRef = { current: progressRef.current?.current_seconds ?? 0 };
    const maxAllowedRef = { current: progressRef.current?.max_seconds ?? resumeAtRef.current };

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
      durationRef.current = durationCached;
      const isSeekingRef = { current: false };
      const lastTimeRef = { current: 0 };
      const lastWallRef = { current: Date.now() };
      playerRef.current = player;
      player.on("play", () => setIsPlaying(true));
      player.on("pause", () => setIsPlaying(false));
      player.on("ended", () => setIsPlaying(false));
      player.ready().then(async () => {
        try {
          durationCached = await player.getDuration();
          durationRef.current = durationCached;
          if (resumeAtRef.current > 5 && durationCached && resumeAtRef.current < durationCached - 3) {
            await player.setCurrentTime(resumeAtRef.current);
            lastTimeRef.current = resumeAtRef.current;
          }
          lastWallRef.current = Date.now();
        } catch {}
      });
      const allowSeek = effectiveAllowSeek;
      const maxRate = Math.max(0.5, Math.min(4, effectiveMaxRate));
      const enforceRate = async () => {
        try {
          const rate = await (player as any).getPlaybackRate?.();
          if (typeof rate === "number" && rate > maxRate) {
            await (player as any).setPlaybackRate?.(maxRate);
          }
        } catch {}
      };
      player.on("playbackratechange", enforceRate);
      player.ready().then(() => { enforceRate(); });
      player.on("timeupdate", (d: any) => {
        const t = d.seconds;
        const nowMs = Date.now();
        const wallDelta = (nowMs - lastWallRef.current) / 1000;
        lastWallRef.current = nowMs;
        const jump = t - lastTimeRef.current;
        // 큰 점프(2초 초과)는 seek 로 간주 → maxAllowed 갱신/전송 금지
        if (jump > 2) {
          isSeekingRef.current = true;
          if (!allowSeek && t > maxAllowedRef.current + 2) {
            player.setCurrentTime(maxAllowedRef.current).catch(() => {});
            lastTimeRef.current = maxAllowedRef.current;
            return;
          }
        }
        currentTimeRef.current = t;
        // 재생속도 기반 검증: 실제 흐른 시간의 (최대배속+0.5)배 이내 증분만 max 로 승격
        if (!isSeekingRef.current && t > maxAllowedRef.current) {
          const allowedGrowth = Math.max(0, wallDelta * (maxRate + 0.5));
          maxAllowedRef.current = Math.min(t, maxAllowedRef.current + allowedGrowth);
        }
        // current_seconds는 실제 마지막 위치를 저장 (이어보기용)
        // max_seconds는 서버에서 이전 최대치 +7초 cap으로 안전하게 계산
        send(t, durationCached);
        lastTimeRef.current = t;
      });
      player.on("seeking", () => { isSeekingRef.current = true; });
      player.on("seeked", (d: any) => {
        if (!allowSeek && d.seconds > maxAllowedRef.current + 2) {
          player.setCurrentTime(maxAllowedRef.current).catch(() => {});
          lastTimeRef.current = maxAllowedRef.current;
        } else {
          if (allowSeek && d.seconds > maxAllowedRef.current) maxAllowedRef.current = d.seconds;
          lastTimeRef.current = d.seconds;
        }
        lastWallRef.current = Date.now();
        isSeekingRef.current = false;
      });
      player.on("pause", (d: any) => {
        currentTimeRef.current = d.seconds;
        send(d.seconds, durationCached);
      });
      player.on("ended", (d: any) => send(d.seconds ?? durationCached ?? 0, durationCached, true));
      seekRef.current = (sec: number) => {
        // 이어보기/최근 시청 클릭은 허용 (maxAllowed 갱신)
        if (sec > maxAllowedRef.current) maxAllowedRef.current = sec;
        lastTimeRef.current = sec;
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
        document.removeEventListener("visibilitychange", onVisibilityChange);
        window.removeEventListener("pagehide", saveOnLeave);
        window.removeEventListener("beforeunload", onBeforeUnload);
        player.destroy().catch(() => {});
      };
    } else if (video.source === "youtube") {
      const allowSeek = effectiveAllowSeek;
      const maxRate = Math.max(0.5, Math.min(4, effectiveMaxRate));
      // iframe 을 컨테이너에 동적으로 생성 (strict-mode 이중 마운트 안전)
      const container = containerRef.current;
      container.innerHTML = "";
      const iframe = document.createElement("iframe");
      iframe.src = `https://www.youtube.com/embed/${video.external_video_id}?enablejsapi=1&playsinline=1&fs=0&origin=${encodeURIComponent(window.location.origin)}`;
      iframe.allow = "autoplay; fullscreen; picture-in-picture; encrypted-media";
      iframe.allowFullscreen = true;
      iframe.title = video.title;
      iframe.className = "absolute inset-0 h-full w-full";
      container.appendChild(iframe);
      iframeRef.current = iframe;
      cleanup = () => {
        document.removeEventListener("visibilitychange", onVisibilityChange);
        window.removeEventListener("pagehide", saveOnLeave);
        window.removeEventListener("beforeunload", onBeforeUnload);
        try { if (container.contains(iframe)) container.removeChild(iframe); } catch {}
      };
      loadYouTubeApi().then((YT) => {
        if (!iframeRef.current || !container.contains(iframeRef.current)) return;
        const maxAllowedRef = { current: progressRef.current?.max_seconds ?? resumeAtRef.current };
        const isSeekingRef = { current: false };
        const lastTimeRef = { current: 0 };
        const enforceRate = () => {
          try {
            const r = player.getPlaybackRate?.();
            if (typeof r === "number" && r > maxRate) player.setPlaybackRate?.(maxRate);
          } catch {}
        };
        const player = new YT.Player(iframeRef.current, {
          events: {
            onReady: () => {
              playerRef.current = player;
              try {
                const d = player.getDuration?.();
                durationRef.current = d ?? null;
                if (resumeAtRef.current > 5 && d && resumeAtRef.current < d - 3) {
                  player.seekTo(resumeAtRef.current, true);
                }
                enforceRate();
                const state = player.getPlayerState?.();
                setIsPlaying(state === 1);
              } catch {}
            },
            onPlaybackRateChange: () => enforceRate(),
            onStateChange: (e: any) => {
              setIsPlaying(e.data === 1);
              const t = player.getCurrentTime?.() ?? 0;
              const d = player.getDuration?.() ?? null;
              currentTimeRef.current = t;
              // 큰 점프만 seek 로 간주 (정상 재생 중 상태 변화는 무시)
              const jump = t - lastTimeRef.current;
              if (jump > 4 && !allowSeek && t > maxAllowedRef.current + 2) {
                try { player.seekTo?.(maxAllowedRef.current, true); } catch {}
                isSeekingRef.current = false;
                lastTimeRef.current = maxAllowedRef.current;
                return;
              }
              if (allowSeek && t > maxAllowedRef.current) maxAllowedRef.current = t;
              if (e.data === 1) isSeekingRef.current = false;
              if (e.data === 0) send(t, d, true);
              else if (e.data === 2) send(t, d);
              lastTimeRef.current = t;
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
        let lastWall = Date.now();
        const iv = setInterval(() => {
          try {
            const state = player.getPlayerState?.();
            if (state === 1) {
              const t = player.getCurrentTime?.() ?? 0;
              const d = player.getDuration?.() ?? null;
              const nowMs = Date.now();
              const wallDelta = (nowMs - lastWall) / 1000;
              lastWall = nowMs;
              currentTimeRef.current = t;
              const jump = t - lastTimeRef.current;
              // 정상 재생 진행분(실제 흐른 시간의 최대배속+0.5배)만큼 먼저 성장 허용
              if (jump <= 4 && t > maxAllowedRef.current) {
                const allowedGrowth = Math.max(0, wallDelta * (maxRate + 0.5));
                maxAllowedRef.current = Math.min(t, maxAllowedRef.current + allowedGrowth);
              }
              if (jump > 4) isSeekingRef.current = true;
              if (!allowSeek && t > maxAllowedRef.current + 2) {
                try { player.seekTo?.(maxAllowedRef.current, true); } catch {}
                lastTimeRef.current = maxAllowedRef.current;
              } else {
                if (allowSeek && t > maxAllowedRef.current) maxAllowedRef.current = t;
                send(t, d);
              }
              if (state === 1) isSeekingRef.current = false;
              lastTimeRef.current = t;
            } else {
              lastWall = Date.now();
            }
          } catch {}
        }, 3000);
        cleanup = () => {
          document.removeEventListener("visibilitychange", onVisibilityChange);
          window.removeEventListener("pagehide", saveOnLeave);
          window.removeEventListener("beforeunload", onBeforeUnload);
          clearInterval(iv);
          try { player.destroy?.(); } catch {}
          try { if (container.contains(iframe)) container.removeChild(iframe); } catch {}
        };
      });
    }

    return () => cleanup();
  }, [video, id, isAuthed, progressLoaded, initialCompleted]);

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
              <div
                ref={containerRef}
                className={isPlayerExpanded ? "relative w-full aspect-video" : "relative aspect-video"}
                onClick={() => {
                  if (isPlayerExpanded) revealFsControls();
                }}
              >
                {/* iframe은 useEffect에서 동적으로 삽입됩니다. */}
              </div>

              {isPlayerExpanded ? (
                <>
                  <div
                    className={cn(
                      "absolute inset-0 z-[110] flex items-start justify-end p-4 transition-opacity duration-300",
                      showFsControls ? "opacity-100" : "opacity-0 pointer-events-none"
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      revealFsControls();
                    }}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsPlayerExpanded(false);
                      }}
                      className="inline-flex items-center gap-2 rounded-xl bg-black/85 px-4 py-3 text-sm font-semibold text-white shadow-2xl ring-1 ring-white/20 backdrop-blur active:scale-95 sm:px-5 sm:py-3.5"
                      aria-label="전체화면 닫기"
                    >
                      <Minimize2 className="h-5 w-5 sm:h-6 sm:w-6" /> 닫기
                    </button>
                  </div>
                  <div
                    className={cn(
                      "absolute inset-0 z-[110] flex items-center justify-center transition-opacity duration-300 pointer-events-none",
                      showFsControls ? "opacity-100" : "opacity-0"
                    )}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        revealFsControls();
                        togglePlayPause();
                      }}
                      className="pointer-events-auto rounded-full bg-black/70 p-5 text-white shadow-2xl ring-1 ring-white/20 backdrop-blur active:scale-95 sm:p-6"
                      aria-label={isPlaying ? "일시정지" : "재생"}
                    >
                      {isPlaying ? (
                        <Pause className="h-8 w-8 sm:h-10 sm:w-10" />
                      ) : (
                        <Play className="h-8 w-8 fill-current sm:h-10 sm:w-10" />
                      )}
                    </button>
                  </div>
                </>

              ) : (
                <button
                  type="button"
                  onClick={() => setIsPlayerExpanded(true)}
                  className="absolute top-2 right-2 z-[110] inline-flex items-center gap-1 rounded-md bg-black/70 px-3 py-1.5 text-xs text-white shadow-lg backdrop-blur hover:bg-black/80"
                  aria-label="전체화면"
                >
                  <Maximize2 className="h-3.5 w-3.5" /> 전체화면
                </button>
              )}
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

            {isAuthed && <CommentsSection videoId={id} />}
          </div>

          <aside className="space-y-4">
            {isAuthed && (
              <BookmarksPanel
                videoId={id}
                getCurrentTime={() => currentTimeRef.current}
                onSeek={(sec) => seekRef.current?.(sec)}
              />
            )}

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
                          <VideoThumb src={r.thumbnail_url} alt="" className="h-full w-full object-cover" />
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
