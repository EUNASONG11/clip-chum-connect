import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listPublicNotices, type PublicNotice } from "@/lib/notices.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Megaphone, Pin, Clock, BookOpen } from "lucide-react";

export const Route = createFileRoute("/notice")({
  head: () => ({
    meta: [
      { title: "공지사항 — 이재식국어" },
      { name: "description", content: "이재식국어 학원 공지사항 안내 페이지입니다." },
      { property: "og:title", content: "공지사항 — 이재식국어" },
      { property: "og:description", content: "이재식국어 학원 공지사항 안내 페이지입니다." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NoticePage,
});

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function relativeTime(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "1분 미만 전";
  if (min < 60) return `${min}분 전`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `약 ${hour}시간 전`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day}일 전`;
  const month = Math.floor(day / 30);
  if (month < 12) return `약 ${month}개월 전`;
  return `약 ${Math.floor(month / 12)}년 전`;
}

/** 카드 본문에 보여줄 요약: 본문 첫 문단 */
function summarize(body: string) {
  const first = (body ?? "").split(/\n\s*\n/)[0]?.trim() ?? "";
  return first.replace(/\n/g, " ") || "자세한 내용은 카드를 눌러 확인하세요.";
}

const TONES = [
  "bg-primary/5 border-primary/15",
  "bg-accent/40 border-border",
  "bg-secondary/60 border-border",
] as const;

function NoticePage() {
  const { data, isLoading } = useQuery({
    queryKey: ["public-notices"],
    queryFn: () => listPublicNotices(),
    staleTime: 60 * 1000,
  });

  const [selected, setSelected] = useState<PublicNotice | null>(null);
  const all = data?.notices ?? [];
  const mains = all.filter((n) => n.display_type === "main");
  const notices = all.filter((n) => n.display_type !== "main");

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b border-border/60 bg-card">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-6 py-5">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary">
            <Megaphone className="h-4 w-4" />
          </span>
          <div>
            <h1 className="text-lg font-bold tracking-tight">공지사항</h1>
            <p className="text-xs text-muted-foreground">이재식국어 학원 안내</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {mains.length === 0 ? (
          <section className="mb-10 rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
            <h2 className="text-base font-semibold sm:text-lg">이재식국어 학원 공지사항 안내</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              학원의 주요 소식, 교육원별 안내, 수업 변경 사항 등을 확인하실 수 있습니다.
              중요 공지는 상단에 고정되어 있으며, 각 카드를 누르면 전체 내용을 확인할 수 있습니다.
            </p>
          </section>
        ) : (
          <div className="mb-10 space-y-4">
            {mains.map((m) => (
              <section key={m.id} className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
                <div className="flex flex-wrap items-center gap-2">
                  {m.is_pinned && (
                    <Badge className="gap-1">
                      <Pin className="h-3 w-3" /> 중요
                    </Badge>
                  )}
                  {m.branch && <Badge variant="secondary">{m.branch}</Badge>}
                </div>
                <h2 className="mt-2 text-lg font-semibold sm:text-xl">{m.title}</h2>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                  {m.body}
                </p>
              </section>
            ))}
          </div>
        )}

        {isLoading ? (
          <p className="py-16 text-center text-sm text-muted-foreground">불러오는 중…</p>
        ) : notices.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            등록된 공지사항이 없습니다.
          </p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {notices.map((n, i) => (
              <button
                key={n.id}
                type="button"
                onClick={() => setSelected(n)}
                className={`group relative flex flex-col rounded-2xl border p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                  TONES[i % TONES.length]
                }`}
              >
                {n.is_pinned && (
                  <Badge className="absolute -top-2 left-4 gap-1 rounded-full px-2 py-0.5 text-[11px] shadow">
                    <Pin className="h-3 w-3" /> 중요
                  </Badge>
                )}
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
                    <BookOpen className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-base font-bold">{n.title}</h2>
                    {n.branch && (
                      <Badge variant="secondary" className="mt-1">
                        {n.branch}
                      </Badge>
                    )}
                  </div>
                </div>

                <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
                  {summarize(n.body)}
                </p>

                <p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" /> {relativeTime(n.created_at)}
                </p>

                <span className="mt-4 block rounded-lg border border-border bg-card px-3 py-2 text-center text-sm font-medium transition group-hover:bg-primary group-hover:text-primary-foreground">
                  자세히 보기
                </span>
              </button>
            ))}
          </div>
        )}
      </main>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <div className="flex flex-wrap items-center gap-2">
              {selected?.is_pinned && (
                <Badge className="gap-1">
                  <Pin className="h-3 w-3" /> 중요
                </Badge>
              )}
              {selected?.branch && <Badge variant="secondary">{selected.branch}</Badge>}
            </div>
            <DialogTitle className="text-left text-xl">{selected?.title}</DialogTitle>
            <p className="text-left text-xs text-muted-foreground">
              {selected ? formatDate(selected.created_at) : ""}
            </p>
          </DialogHeader>
          <div className="whitespace-pre-wrap text-sm leading-relaxed">
            {selected?.body || "내용이 없습니다."}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
