import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import VimeoPlayer from "@vimeo/player";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Bookmark, Maximize2, MessageSquare } from "lucide-react";
import { RoleGate } from "@/components/AdminRole";
import { listVideoAllComments, listVideoAllBookmarks } from "@/lib/social.functions";

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
  class_id: string | null;
};

export const Route = createFileRoute("/admin/video/$id")({
  component: () => (
    <RoleGate>
      <AdminVideoPage />
    </RoleGate>
  ),
  notFoundComponent: () => (
    <div className="p-10 text-center">
      <p>영상을 찾을 수 없습니다.</p>
      <Link to="/admin/videos" className="text-primary underline">등록된 영상으로</Link>
    </div>
  ),
  errorComponent: ({ error }) => (
    <div className="p-10 text-center text-destructive">{error.message}</div>
  ),
});

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

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function AdminVideoPage() {
  const { id } = Route.useParams();
  const [video, setVideo] = useState<Video | null | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const seekRef = useRef<(sec: number) => void>(() => {});
  const [isPlayerExpanded, setIsPlayerExpanded] = useState(false);

  useEffect(() => {
    supabase
      .from("videos")
      .select("id,title,description,source,vimeo_video_id,external_video_id,player_embed_url,thumbnail_url,duration,class_id")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle()
      .then(({ data }) => setVideo((data as Video | null) ?? null));
  }, [id]);

  const { data: comments = [] } = useQuery({
    queryKey: ["admin", "video", id, "comments"],
    queryFn: () => listVideoAllComments({ data: { videoId: id } }),
    enabled: !!video,
  });
  const { data: bookmarks = [] } = useQuery({
    queryKey: ["admin", "video", id, "bookmarks"],
    queryFn: () => listVideoAllBookmarks({ data: { videoId: id } }),
    enabled: !!video,
  });

  useEffect(() => {
    if (!isPlayerExpanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const orientation = (screen as any).orientation;
    if (orientation?.lock) orientation.lock("landscape").catch(() => {});
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsPlayerExpanded(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      if (orientation?.unlock) { try { orientation.unlock(); } catch {} }
    };
  }, [isPlayerExpanded]);

  useEffect(() => {
    if (!video || !containerRef.current) return;
    let cleanup = () => {};

    if (video.source === "vimeo") {
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
      seekRef.current = (sec: number) => {
        player.setCurrentTime(sec).catch(() => {});
        player.play().catch(() => {});
      };
      cleanup = () => { player.destroy().catch(() => {}); };
    } else if (video.source === "youtube") {
      loadYouTubeApi().then((YT) => {
        if (!iframeRef.current) return;
        const player = new YT.Player(iframeRef.current, {});
        seekRef.current = (sec: number) => {
          try { player.seekTo?.(sec, true); player.playVideo?.(); } catch {}
        };
        cleanup = () => { try { player.destroy?.(); } catch {} };
      });
    }
    return () => cleanup();
  }, [video]);

  if (video === undefined) {
    return <p className="text-muted-foreground">불러오는 중...</p>;
  }
  if (video === null) throw notFound();

  // Group bookmarks by student
  const bookmarksByUser = new Map<string, { name: string; phone: string | null; items: typeof bookmarks }>();
  for (const b of bookmarks) {
    const key = b.user_id;
    if (!bookmarksByUser.has(key)) {
      bookmarksByUser.set(key, { name: b.author_name, phone: b.author_phone, items: [] });
    }
    bookmarksByUser.get(key)!.items.push(b);
  }

  return (
    <div>
      {video.class_id ? (
        <Link
          to="/admin/classes/$id"
          params={{ id: video.class_id }}
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> 수강반으로
        </Link>
      ) : (
        <Link to="/admin/videos" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> 등록된 영상으로
        </Link>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
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
              onClick={() => setIsPlayerExpanded((v) => !v)}
              className="absolute bottom-2 right-2 z-[110] inline-flex items-center gap-1 rounded-md bg-black/70 px-3 py-1.5 text-xs text-white shadow-lg backdrop-blur hover:bg-black/80 md:hidden"
              aria-label={isPlayerExpanded ? "전체화면 닫기" : "전체화면"}
            >
              <Maximize2 className="h-3.5 w-3.5" /> {isPlayerExpanded ? "닫기" : "전체화면"}
            </button>
          </div>

          <h1 className="mt-6 text-3xl font-bold">{video.title}</h1>
          <p className="mt-1 text-xs text-muted-foreground">강사/관리자 미리보기 · 진도 저장 없음</p>
          {video.description && (
            <p className="mt-3 whitespace-pre-wrap text-muted-foreground">{video.description}</p>
          )}

          <section className="mt-10">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
              <MessageSquare className="h-5 w-5" /> 학생 댓글 {comments.length > 0 && `(${comments.length})`}
            </h2>
            {comments.length === 0 ? (
              <p className="text-sm text-muted-foreground">등록된 댓글이 없습니다.</p>
            ) : (
              <ul className="space-y-3">
                {comments.map((c: any) => (
                  <li key={c.id} className="rounded-lg border p-4">
                    <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {c.author_name}
                        {c.author_phone && <span className="ml-2 text-muted-foreground">{c.author_phone}</span>}
                      </span>
                      <span>{new Date(c.created_at).toLocaleString("ko-KR")}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm">{c.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-lg border p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Bookmark className="h-4 w-4" /> 학생 북마크 ({bookmarks.length})
            </h3>
            {bookmarksByUser.size === 0 ? (
              <p className="text-xs text-muted-foreground">등록된 북마크가 없습니다.</p>
            ) : (
              <div className="space-y-4">
                {Array.from(bookmarksByUser.entries()).map(([uid, group]) => (
                  <div key={uid}>
                    <p className="mb-1 text-xs font-medium text-foreground">
                      {group.name}
                      {group.phone && <span className="ml-1 text-muted-foreground">· {group.phone}</span>}
                    </p>
                    <ul className="space-y-2">
                      {group.items.map((b: any) => (
                        <li key={b.id} className="flex items-center gap-2 text-sm">
                          <button
                            onClick={() => seekRef.current?.(b.seconds)}
                            className="rounded bg-muted px-2 py-1 font-mono text-xs hover:bg-muted/70"
                          >
                            {fmt(b.seconds)}
                          </button>
                          <span className="flex-1 truncate text-muted-foreground">{b.note || "—"}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
