import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import VimeoPlayer from "@vimeo/player";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/SiteHeader";
import { ArrowLeft, CheckCircle2, Maximize2, Minimize2, Pause, Play, RotateCcw, RotateCw, Subtitles } from "lucide-react";

function fmtTime(sec: number) {
  const s = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

import { Progress } from "@/components/ui/progress";
import { getMyProgress, upsertMyProgress, listRecentlyWatched, logSeekAttempt } from "@/lib/progress.functions";
import { CommentsSection } from "@/components/CommentsSection";
import { BookmarksPanel } from "@/components/BookmarksPanel";
import { VideoThumb } from "@/components/VideoThumb";
import { cn } from "@/lib/utils";
import { useRotatedFullscreen } from "@/hooks/use-rotated-fullscreen";

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
  return `${video.player_embed_url}${separator}title=0&byline=0&portrait=0&vimeo_logo=0&responsive=1&fullscreen=0&share=0&embed=0&pip=0&dnt=1&controls=0&keyboard=0`;
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
  const wrapperRef = useRef<HTMLDivElement>(null);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const lastSentRef = useRef(0);
  const currentTimeRef = useRef(0);
  const durationRef = useRef<number | null>(null);
  const seekRef = useRef<(sec: number) => Promise<void>>(async () => {});
  const fullscreenRef = useRef<() => void>(() => {});
  const captionsRef = useRef<(on: boolean) => void>(() => {});
  const captionsOnRef = useRef(false);
  const [captionsOn, setCaptionsOn] = useState(false);
  const [captionsAvailable, setCaptionsAvailable] = useState<boolean | null>(null);
  const toggleCaptions = () => {
    if (captionsAvailable !== true) return;
    const next = !captionsOnRef.current;
    captionsOnRef.current = next;
    setCaptionsOn(next);
    captionsRef.current?.(next);
  };

  const playerRef = useRef<any>(null);


  const isPlayingRef = useRef(false);
  const [ratio, setRatio] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [progressLoaded, setProgressLoaded] = useState(false);
  const [initialCompleted, setInitialCompleted] = useState(false);
  const [isPlayerExpanded, setIsPlayerExpanded] = useState(false);
  const [showFsControls, setShowFsControls] = useState(false);
  const fsControlsTimerRef = useRef<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const fsFallbackRef = useRef(false);
  const [fsFallback, setFsFallback] = useState(false);
  const { style: fsStyle } = useRotatedFullscreen(isPlayerExpanded, fsFallback);
  const [fsTime, setFsTime] = useState(0);
  const [fsDuration, setFsDuration] = useState(0);
  const scrubbingRef = useRef(false);
  const seekCommitTimerRef = useRef<number | null>(null);
  const seekRequestIdRef = useRef(0);
  const lastSeekCommitRef = useRef<{ value: number; at: number } | null>(null);

  const commitFullscreenSeek = (value: number) => {
    const next = Number(value);
    if (!Number.isFinite(next)) return;

    if (seekCommitTimerRef.current) {
      window.clearTimeout(seekCommitTimerRef.current);
      seekCommitTimerRef.current = null;
    }
    const now = Date.now();
    const previous = lastSeekCommitRef.current;
    if (previous && previous.value === next && now - previous.at < 500) return;
    lastSeekCommitRef.current = { value: next, at: now };
    const requestId = ++seekRequestIdRef.current;

    scrubbingRef.current = true;
    setFsTime(next);
    void seekRef.current(next).finally(() => {
      if (requestId !== seekRequestIdRef.current) return;
      scrubbingRef.current = false;
      setFsTime(currentTimeRef.current);
    });
    revealFsControls();
  };

  const scheduleFullscreenSeek = (value: number) => {
    if (seekCommitTimerRef.current) window.clearTimeout(seekCommitTimerRef.current);
    seekCommitTimerRef.current = window.setTimeout(() => {
      seekCommitTimerRef.current = null;
      commitFullscreenSeek(value);
    }, 160);
  };

  const nudge = (delta: number) => {
    const base = currentTimeRef.current || 0;
    const max = fsDuration || durationRef.current || base;
    const target = Math.max(0, Math.min(max, base + delta));
    void seekRef.current(target);
    setFsTime(target);
  };

  const revealFsControls = () => {
    setShowFsControls(true);
    if (fsControlsTimerRef.current) window.clearTimeout(fsControlsTimerRef.current);
    fsControlsTimerRef.current = window.setTimeout(() => setShowFsControls(false), 5000);
  };


  const hideFsControls = () => {
    if (fsControlsTimerRef.current) window.clearTimeout(fsControlsTimerRef.current);
    setShowFsControls(false);
  };

  const exitNativeFullscreen = async () => {
    const d = document as any;
    try {
      if (document.fullscreenElement || d.webkitFullscreenElement || d.mozFullScreenElement || d.msFullscreenElement) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (d.webkitExitFullscreen) await d.webkitExitFullscreen();
        else if (d.mozCancelFullScreen) await d.mozCancelFullScreen();
        else if (d.msExitFullscreen) await d.msExitFullscreen();
      }
    } catch {}
  };

  const enterFullscreen = async () => {
    // 래퍼 전체를 전체화면으로 → 우리가 만든 진도바/재생 버튼이 전체화면에서도 보인다
    const opened =
      (await requestElementFullscreen(wrapperRef.current)) ||
      (await requestElementFullscreen(containerRef.current));
    if (opened) {
      fsFallbackRef.current = false;
      setFsFallback(false);
      setIsPlayerExpanded(true);
    } else {
      fsFallbackRef.current = true;
      setFsFallback(true);
      setIsPlayerExpanded(true);
    }
  };


  const exitFullscreen = async () => {
    await exitNativeFullscreen();
    setIsPlayerExpanded(false);
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
    const onFsChange = () => {
      const d = document as any;
      const active = !!(document.fullscreenElement || d.webkitFullscreenElement || d.mozFullScreenElement || d.msFullscreenElement);
      if (!active && !fsFallbackRef.current) {
        setIsPlayerExpanded(false);
        if (fsControlsTimerRef.current) window.clearTimeout(fsControlsTimerRef.current);
        setShowFsControls(false);
      }
    };
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);
    document.addEventListener("mozfullscreenchange", onFsChange);
    document.addEventListener("MSFullscreenChange", onFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("webkitfullscreenchange", onFsChange);
      document.removeEventListener("mozfullscreenchange", onFsChange);
      document.removeEventListener("MSFullscreenChange", onFsChange);
    };
  }, []);

  // 전체화면 진도바용 시간/길이 폴링
  useEffect(() => {
    if (!isPlayerExpanded) return;
    const tick = async () => {
      const player = playerRef.current;
      try {
        if (video?.source === "vimeo" && player) {
          const [t, d] = await Promise.all([player.getCurrentTime(), player.getDuration()]);
          if (typeof d === "number" && d > 0) setFsDuration(d);
          if (!scrubbingRef.current && typeof t === "number") setFsTime(t);
        } else if (video?.source === "youtube" && player) {
          const d = player.getDuration?.();
          const t = player.getCurrentTime?.();
          if (typeof d === "number" && d > 0) setFsDuration(d);
          if (!scrubbingRef.current && typeof t === "number") setFsTime(t);
        }
      } catch {}
    };
    void tick();
    const iv = window.setInterval(tick, 500);
    return () => window.clearInterval(iv);
  }, [isPlayerExpanded, video?.source]);

  useEffect(() => {
    if (!isPlayerExpanded) {
      if (fsControlsTimerRef.current) window.clearTimeout(fsControlsTimerRef.current);
      setShowFsControls(false);
      return;
    }
    setShowFsControls(true);
    if (fsControlsTimerRef.current) window.clearTimeout(fsControlsTimerRef.current);
    fsControlsTimerRef.current = window.setTimeout(() => setShowFsControls(false), 5000);



    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const orientation = (screen as any).orientation;
    if (orientation?.lock) {
      orientation.lock("landscape").catch(() => {});
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") exitFullscreen();
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

    // 실제 재생된 시간 누적 (전송 시 서버로 넘기고 초기화)
    const watchedAccRef = { current: 0 };
    const lastSeekLogRef = { current: 0 };
    const logSeek = (from: number, to: number, blocked: boolean) => {
      if (!isAuthed) return;
      const now = Date.now();
      if (now - lastSeekLogRef.current < 1500) return;
      lastSeekLogRef.current = now;
      logSeekAttempt({
        data: {
          videoId: id,
          fromSeconds: Math.max(0, Math.floor(from)),
          toSeconds: Math.max(0, Math.floor(to)),
          blocked,
        },
      }).catch(() => {});
    };

    const send = async (currentSeconds: number, duration: number | null, ended = false, force = false) => {
      if (!isAuthed) return;
      const now = Date.now();
      if (!force && !ended && now - lastSentRef.current < 4500) return;
      lastSentRef.current = now;
      const delta = watchedAccRef.current;
      watchedAccRef.current = 0;
      try {
        const r = await upsertMyProgress({
          data: {
            videoId: id,
            currentSeconds: Math.floor(currentSeconds),
            duration: duration ? Math.floor(duration) : null,
            endedEvent: ended,
            watchedDelta: Math.min(600, Math.max(0, Math.round(delta))),
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
      fullscreenRef.current = () => {
        void (async () => {
          const opened = await requestElementFullscreen(containerRef.current);
          if (!opened) setIsPlayerExpanded(true);
        })();
      };
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
        // 자막(자동 생성 포함)은 기본 OFF — 학생이 필요할 때만 켤 수 있게
        try { await (player as any).disableTextTrack?.(); } catch {}
        try {
          const tracks = (await (player as any).getTextTracks?.()) ?? [];
          setCaptionsAvailable(tracks.length > 0);
        } catch {
          setCaptionsAvailable(false);
        }
      });
      // 자막 켜기/끄기
      captionsRef.current = (on: boolean) => {
        void (async () => {
          try {
            if (!on) {
              await (player as any).disableTextTrack?.();
              return;
            }
            const tracks = (await (player as any).getTextTracks?.()) ?? [];
            const preferred = tracks.find((track: any) => track.language === "ko") ?? tracks[0];
            if (preferred) {
              await (player as any).enableTextTrack?.(preferred.language, preferred.kind);
            }
          } catch {}
        })();
      };
      // 자막이 자동으로 다시 켜지는 경우 방지
      player.on("texttrackchange", (d: any) => {
        if (!captionsOnRef.current && d?.language) {
          (player as any).disableTextTrack?.()?.catch?.(() => {});
        }
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
            logSeek(lastTimeRef.current, t, true);
            player.setCurrentTime(maxAllowedRef.current).catch(() => {});
            lastTimeRef.current = maxAllowedRef.current;
            return;
          }
        }
        currentTimeRef.current = t;
        // 실제 재생분만 누적 (정상 진행 구간)
        if (jump > 0 && jump <= 2) watchedAccRef.current += jump;
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
      player.on("seeking", (d: any) => {
        isSeekingRef.current = true;
        // 버퍼링 이후가 아니라 seek 시작 즉시 되돌려서 체감 지연을 없앤다
        const t = typeof d?.seconds === "number" ? d.seconds : null;
        if (!allowSeek && t !== null && t > maxAllowedRef.current + 2) {
          logSeek(lastTimeRef.current, t, true);
          player.setCurrentTime(maxAllowedRef.current).catch(() => {});
          lastTimeRef.current = maxAllowedRef.current;
        }
      });
      player.on("seeked", (d: any) => {
        if (!allowSeek && d.seconds > maxAllowedRef.current + 2) {
          logSeek(lastTimeRef.current, d.seconds, true);
          player.setCurrentTime(maxAllowedRef.current).catch(() => {});
          lastTimeRef.current = maxAllowedRef.current;
        } else {
          if (Math.abs(d.seconds - lastTimeRef.current) > 2) logSeek(lastTimeRef.current, d.seconds, false);
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
      seekRef.current = async (sec: number) => {
        // 건너뛰기 금지 설정이면 아직 시청하지 않은 지점으로는 이동 불가
        let target = sec;
        if (!effectiveAllowSeek && sec > maxAllowedRef.current + 1) {
          logSeek(currentTimeRef.current, sec, true);
          target = maxAllowedRef.current;
        }
        if (target > maxAllowedRef.current) maxAllowedRef.current = target;
        isSeekingRef.current = true;
        lastTimeRef.current = target;
        currentTimeRef.current = target;
        setFsTime(target);
        try {
          await player.ready();
          let resolved = target;
          // 일부 모바일 WebView에서는 첫 setCurrentTime 메시지가 유실될 수 있어
          // 실제 위치를 확인하고 짧게 재시도한다.
          for (let attempt = 0; attempt < 3; attempt += 1) {
            const actual = await player.setCurrentTime(target);
            resolved = typeof actual === "number" ? actual : target;
            await new Promise((resolve) => window.setTimeout(resolve, 120));
            const confirmed = await player.getCurrentTime();
            if (typeof confirmed === "number") resolved = confirmed;
            if (Math.abs(resolved - target) <= 1.5) break;
          }
          currentTimeRef.current = resolved;
          lastTimeRef.current = resolved;
          setFsTime(resolved);
          await player.play();
        } catch {
          try {
            const actual = await player.getCurrentTime();
            if (typeof actual === "number") {
              currentTimeRef.current = actual;
              lastTimeRef.current = actual;
              setFsTime(actual);
            }
          } catch {}
        } finally {
          isSeekingRef.current = false;
          lastWallRef.current = Date.now();
        }
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
      iframe.src = `https://www.youtube.com/embed/${video.external_video_id}?enablejsapi=1&playsinline=1&fs=0&hl=ko&origin=${encodeURIComponent(window.location.origin)}`;
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
        let captionsRetryTimer: number | null = null;
        const selectYouTubeCaptionTrack = (retries = 12, activate = true) => {
          try {
            const list = player.getOption?.("captions", "tracklist") ?? [];
            const preferred =
              list.find?.((track: any) => track.languageCode === "ko" || track.languageCode === "ko-KR") ??
              list[0];
            if (preferred) {
              setCaptionsAvailable(true);
              if (activate) {
                // YouTube가 반환한 트랙 객체를 그대로 다시 전달해야 자동 생성(ASR) 자막도 켜진다.
                player.setOption?.("captions", "track", preferred);
              } else {
                player.setOption?.("captions", "track", {});
              }
              return;
            }

            if (retries > 0) {
              if (captionsRetryTimer) window.clearTimeout(captionsRetryTimer);
              captionsRetryTimer = window.setTimeout(
                () => selectYouTubeCaptionTrack(retries - 1, activate),
                500,
              );
            } else {
              setCaptionsAvailable(false);
            }
          } catch {}
        };
        const applyYouTubeCaptions = (on: boolean) => {
          if (captionsRetryTimer) {
            window.clearTimeout(captionsRetryTimer);
            captionsRetryTimer = null;
          }
          try {
            if (!on) {
              player.setOption?.("captions", "track", {});
              player.unloadModule?.("captions");
              return;
            }
            // 실제 YouTube IFrame Player의 captions 모듈을 로드한다.
            player.loadModule?.("captions");
            selectYouTubeCaptionTrack();
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
                logSeek(lastTimeRef.current, t, true);
                try { player.seekTo?.(maxAllowedRef.current, true); } catch {}
                isSeekingRef.current = false;
                lastTimeRef.current = maxAllowedRef.current;
                return;
              }
              if (Math.abs(jump) > 4 && allowSeek) logSeek(lastTimeRef.current, t, false);
              if (allowSeek && t > maxAllowedRef.current) maxAllowedRef.current = t;
              if (e.data === 1) {
                isSeekingRef.current = false;
              }
              if (e.data === 0) send(t, d, true);
              else if (e.data === 2) send(t, d);
              lastTimeRef.current = t;

            },
          },
        });
        seekRef.current = async (sec: number) => {
          let target = sec;
          if (!effectiveAllowSeek && sec > maxAllowedRef.current + 1) {
            logSeek(currentTimeRef.current, sec, true);
            target = maxAllowedRef.current;
          }
          if (target > maxAllowedRef.current) maxAllowedRef.current = target;
          currentTimeRef.current = target;
          lastTimeRef.current = target;
          setFsTime(target);
          try {
            player.seekTo?.(target, true);
            player.playVideo?.();
          } catch {}
        };
        // YouTube 자막은 플레이어 하단의 기본 CC 버튼이 직접 제어한다.
        captionsRef.current = () => {};



        fullscreenRef.current = () => {
          void (async () => {
            const opened =
              (await requestElementFullscreen(iframeRef.current)) ||
              (await requestElementFullscreen(containerRef.current));
            if (!opened) setIsPlayerExpanded(true);
          })();
        };
        let lastWall = Date.now();
        // 건너뛰기 감시 전용 고속 루프 (0.25초) — 3초 주기 진도 저장과 분리해 즉시 되돌린다
        const guardIv = setInterval(() => {
          if (allowSeek) return;
          try {
            const t = player.getCurrentTime?.() ?? 0;
            if (t > maxAllowedRef.current + 2) {
              logSeek(lastTimeRef.current, t, true);
              player.seekTo?.(maxAllowedRef.current, true);
              lastTimeRef.current = maxAllowedRef.current;
              currentTimeRef.current = maxAllowedRef.current;
              lastWall = Date.now();
            }
          } catch {}
        }, 250);
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
              // 실제 재생분만 누적 (정상 진행 구간, tick 3초 기준)
              if (jump > 0 && jump <= 4) watchedAccRef.current += jump;
              // 정상 재생 진행분(실제 흐른 시간의 최대배속+0.5배)만큼 먼저 성장 허용
              if (jump <= 4 && t > maxAllowedRef.current) {
                const allowedGrowth = Math.max(0, wallDelta * (maxRate + 0.5));
                maxAllowedRef.current = Math.min(t, maxAllowedRef.current + allowedGrowth);
              }
              if (jump > 4) isSeekingRef.current = true;
              if (!allowSeek && t > maxAllowedRef.current + 2) {
                logSeek(lastTimeRef.current, t, true);
                try { player.seekTo?.(maxAllowedRef.current, true); } catch {}
                lastTimeRef.current = maxAllowedRef.current;
              } else {
                if (Math.abs(jump) > 4) logSeek(lastTimeRef.current, t, false);
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
          clearInterval(guardIv);
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
              ref={wrapperRef}
              className={
                isPlayerExpanded
                  ? "fixed inset-0 z-[100] flex h-[100dvh] w-screen items-center justify-center overflow-hidden bg-black"
                  : "relative overflow-hidden rounded-xl border bg-black"
              }
            >
              <div
                ref={containerRef}
                className="relative aspect-video"
                style={isPlayerExpanded ? fsStyle : undefined}

                onClick={() => {
                  if (isPlayerExpanded) revealFsControls();
                }}
              >
                {/* iframe은 useEffect에서 동적으로 삽입됩니다. */}
              </div>

              {isPlayerExpanded ? (
                <>
                  {!showFsControls && (
                    <div
                      className="absolute inset-x-0 top-0 bottom-[20%] z-[105]"
                      onClick={(e) => {
                        e.stopPropagation();
                        revealFsControls();
                      }}
                    />
                  )}
                  <div
                    className={cn(
                      "absolute inset-0 z-[110] flex items-start justify-end p-4 transition-opacity duration-300",
                      showFsControls ? "opacity-100" : "opacity-0 pointer-events-none"
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      hideFsControls();
                    }}
                  >
                    <div className="flex items-center gap-2">
                      {video.source !== "youtube" && <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          revealFsControls();
                          toggleCaptions();
                        }}
                         disabled={captionsAvailable !== true}
                        className={cn(
                          "inline-flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-2xl ring-1 ring-white/20 backdrop-blur active:scale-95",
                          captionsOn ? "bg-primary/90" : "bg-black/85"
                        )}
                         aria-label={captionsAvailable === false ? "자막 없음" : captionsOn ? "자막 끄기" : "자막 켜기"}
                      >
                         <Subtitles className="h-5 w-5" /> {captionsAvailable === false ? "자막 없음" : `자막 ${captionsOn ? "켜짐" : "꺼짐"}`}
                      </button>}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      exitFullscreen();
                    }}
                    className="inline-flex items-center gap-2 rounded-xl bg-black/85 px-4 py-3 text-sm font-semibold text-white shadow-2xl ring-1 ring-white/20 backdrop-blur active:scale-95 sm:px-5 sm:py-3.5"
                    aria-label="전체화면 닫기"
                  >
                    <Minimize2 className="h-5 w-5 sm:h-6 sm:w-6" /> 닫기
                  </button>
                </div>
              </div>
              <div
                className={cn(
                  "absolute inset-0 z-[110] flex items-center justify-center gap-6 transition-opacity duration-300 pointer-events-none",
                  showFsControls ? "opacity-100" : "opacity-0 [&>*]:pointer-events-none"
                )}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    revealFsControls();
                    nudge(-10);
                  }}
                  className="pointer-events-auto rounded-full bg-black/60 p-3 text-white shadow-2xl ring-1 ring-white/20 backdrop-blur active:scale-95"
                  aria-label="10초 뒤로"
                >
                  <RotateCcw className="h-6 w-6" />
                </button>
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
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    revealFsControls();
                    nudge(10);
                  }}
                  className="pointer-events-auto rounded-full bg-black/60 p-3 text-white shadow-2xl ring-1 ring-white/20 backdrop-blur active:scale-95"
                  aria-label="10초 앞으로"
                >
                  <RotateCw className="h-6 w-6" />
                </button>
              </div>

              {/* 전체화면 하단 진도바 (직접 조작 가능) */}
              <div
                className={cn(
                  "absolute inset-x-0 bottom-0 z-[115] flex items-center gap-3 bg-black px-4 pb-5 pt-4 shadow-[0_-24px_32px_16px_rgba(0,0,0,0.9)] transition-opacity duration-300",
                  showFsControls ? "opacity-100" : "opacity-0 pointer-events-none"
                )}
                onClick={(e) => e.stopPropagation()}
              >
                <span className="w-12 shrink-0 text-right font-mono text-xs text-white">
                  {fmtTime(fsTime)}
                </span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(1, fsDuration)}
                  step={1}
                  value={Math.min(fsTime, Math.max(1, fsDuration))}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    scrubbingRef.current = true;
                    setFsTime(next);
                    scheduleFullscreenSeek(next);
                    revealFsControls();
                  }}
                  onPointerUp={(e) => {
                    commitFullscreenSeek(Number(e.currentTarget.value));
                  }}
                  onTouchEnd={(e) => {
                    commitFullscreenSeek(Number(e.currentTarget.value));
                  }}
                  onMouseUp={(e) => {
                    commitFullscreenSeek(Number(e.currentTarget.value));
                  }}
                  onKeyUp={(e) => {
                    commitFullscreenSeek(Number(e.currentTarget.value));
                  }}
                  className="h-6 w-full cursor-pointer accent-primary"
                  aria-label="재생 위치"
                />
                <span className="w-12 shrink-0 font-mono text-xs text-white/70">
                  {fmtTime(fsDuration)}
                </span>
              </div>
            </>


          ) : (
            <div className="absolute bottom-14 right-3 z-[110] flex items-center gap-1.5">
              {video.source !== "youtube" && <button
                type="button"
                onClick={toggleCaptions}
                 disabled={captionsAvailable !== true}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs text-white shadow-lg backdrop-blur",
                  captionsOn ? "bg-primary/90 hover:bg-primary" : "bg-black/70 hover:bg-black/80"
                )}
                 aria-label={captionsAvailable === false ? "자막 없음" : captionsOn ? "자막 끄기" : "자막 켜기"}
              >
                 <Subtitles className="h-3.5 w-3.5" /> {captionsAvailable === false ? "자막 없음" : `자막 ${captionsOn ? "켜짐" : "꺼짐"}`}
              </button>}
              <button
                type="button"
                onClick={() => enterFullscreen()}
                className="inline-flex items-center gap-1 rounded-md bg-black/70 px-3 py-1.5 text-xs text-white shadow-lg backdrop-blur hover:bg-black/80"
                aria-label="전체화면"
              >
                <Maximize2 className="h-3.5 w-3.5" /> 전체화면
              </button>
            </div>
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
