import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SiteHeader } from "@/components/SiteHeader";
import { Card, CardContent } from "@/components/ui/card";
import { ClassThumb } from "@/components/ClassThumb";
import { ArrowLeft, Play, Film, CheckCircle2 } from "lucide-react";
import { getClass, listClassVideos } from "@/lib/classes.functions";

export const Route = createFileRoute("/class/$id")({
  component: ClassPage,
  errorComponent: ({ error }) => (
    <div className="p-10 text-center text-destructive">{error.message}</div>
  ),
  notFoundComponent: () => (
    <div className="p-10 text-center">
      <p>수강반을 찾을 수 없습니다.</p>
      <Link to="/" className="text-primary underline">홈으로</Link>
    </div>
  ),
});

function formatDuration(sec: number | null) {
  if (!sec) return "";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

function ClassPage() {
  const { id } = Route.useParams();
  const { data: cls, isLoading: loadingCls } = useQuery({
    queryKey: ["class", id],
    queryFn: () => getClass({ data: { id } }),
  });
  const { data: videos = [], isLoading } = useQuery({
    queryKey: ["class", id, "videos"],
    queryFn: () => listClassVideos({ data: { classId: id } }),
  });

  if (!loadingCls && !cls) throw notFound();

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <Link
          to="/"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> 내 수강반
        </Link>
        <h1 className="text-3xl font-bold">{cls?.name ?? "..."}</h1>
        {cls?.description && (
          <p className="mt-2 text-muted-foreground">{cls.description}</p>
        )}

        <div className="mt-8">
          {isLoading && <p className="text-muted-foreground">불러오는 중...</p>}
          {!isLoading && videos.length === 0 && (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
                <Film className="h-10 w-10 text-muted-foreground" />
                <p className="text-lg font-medium">아직 공개된 영상이 없습니다.</p>
              </CardContent>
            </Card>
          )}

          <div className="flex flex-col gap-3">
            {videos.map((v: any) => (
              <Link
                key={v.id}
                to="/video/$id"
                params={{ id: v.id }}
                className="group flex items-center gap-4 rounded-xl border bg-card p-3 transition hover:bg-accent/50"
              >
                <div className="relative w-28 shrink-0 overflow-hidden rounded-lg aspect-video bg-muted">
                  {v.thumbnail_url ? (
                    <ClassThumb
                      src={v.thumbnail_url}
                      alt={v.title}
                      className="h-full w-full object-cover transition group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Film className="h-8 w-8 text-muted-foreground" />
                    </div>
                  )}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/30">
                    <Play className="h-8 w-8 text-white opacity-0 transition group-hover:opacity-100" />
                  </div>
                </div>

                <div className="flex min-w-0 flex-1 flex-col justify-center">
                  <h3 className="line-clamp-1 font-semibold">{v.title}</h3>
                  <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Play className="h-3 w-3" />
                    <span>{formatDuration(v.duration)}</span>
                  </div>
                </div>

                <div className="shrink-0 pr-1">
                  {v.progress?.is_completed ? (
                    <CheckCircle2 className="h-6 w-6 text-green-500" />
                  ) : (
                    <CheckCircle2 className="h-6 w-6 text-muted-foreground/30" />
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
