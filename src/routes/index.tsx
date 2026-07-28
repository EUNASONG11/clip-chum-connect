import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { GraduationCap, Film } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { listClasses } from "@/lib/classes.functions";
import { getMyRole } from "@/lib/vimeo.functions";
import { ClassThumb } from "@/components/ClassThumb";


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "이재식국어 — 강의 플랫폼" },
      { name: "description", content: "이재식국어 학생 전용 강의 시청 플랫폼." },
      { property: "og:title", content: "이재식국어 — 강의 플랫폼" },
      { property: "og:description", content: "이재식국어 학생 전용 강의 시청 플랫폼." },
      { property: "og:type", content: "website" },
    ],
  }),
  component: Home,
});

function Home() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        navigate({ to: "/login", replace: true });
        return;
      }
      try {
        const { getMyStatus } = await import("@/lib/vimeo.functions");
        const s = await getMyStatus();
        if (s.isAdmin || s.isInstructor) {
          navigate({ to: "/admin", replace: true });
          return;
        }
      } catch {}
      setReady(true);
    })();
  }, [navigate]);

  const { data: classes = [], isLoading } = useQuery({
    queryKey: ["my", "classes"],
    queryFn: () => listClasses(),
    enabled: ready,
  });

  if (!ready) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <p className="p-10 text-muted-foreground">불러오는 중...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-10">
        <section className="mb-10">
          <h1 className="text-4xl font-bold tracking-tight">내 수강반</h1>
          <p className="mt-2 text-muted-foreground">
            수강 중인 반을 선택하여 강의를 시청하세요.
          </p>
        </section>

        {isLoading && <p className="text-muted-foreground">불러오는 중...</p>}
        {!isLoading && classes.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
              <GraduationCap className="h-10 w-10 text-muted-foreground" />
              <p className="text-lg font-medium">아직 배정된 수강반이 없습니다.</p>
              <p className="text-sm text-muted-foreground">
                관리자에게 수강반 배정을 요청하세요.
              </p>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-3">
          {classes.map((c: any) => {
            const today = new Date().toISOString().slice(0, 10);
            const isExpired = c.active_to && today > c.active_to;
            const isUpcoming = c.active_from && today < c.active_from;
            const isInactive = isExpired || isUpcoming;
            return (
              <Link
                key={c.id}
                to="/class/$id"
                params={{ id: c.id }}
                className={`group overflow-hidden rounded-xl border bg-card transition hover:shadow-lg ${
                  isInactive ? "opacity-60" : ""
                }`}
              >
                <div className="relative aspect-video w-full overflow-hidden bg-muted">
                  {c.thumbnail_url ? (
                    <ClassThumb
                      src={c.thumbnail_url}
                      alt={c.name}
                      className="h-full w-full object-cover transition group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Film className="h-10 w-10 text-muted-foreground/60" />
                    </div>
                  )}
                  {isExpired && (
                    <span className="absolute left-2 top-2 rounded bg-red-600 px-2 py-0.5 text-[10px] font-medium text-white">
                      종료됨
                    </span>
                  )}
                  {isUpcoming && (
                    <span className="absolute left-2 top-2 rounded bg-yellow-500 px-2 py-0.5 text-[10px] font-medium text-white">
                      시작 예정
                    </span>
                  )}
                </div>
                <div className="p-3">
                  <h3 className="truncate text-sm font-semibold group-hover:text-primary">{c.name}</h3>
                  {c.description && (
                    <p className="line-clamp-2 mt-0.5 text-xs text-muted-foreground">
                      {c.description}
                    </p>
                  )}
                  {(c.active_from || c.active_to) && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {c.active_from ?? "-"} ~ {c.active_to ?? "-"}
                    </p>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </main>
    </div>
  );
}
