import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { getPublicNotice } from "@/lib/notices.functions";
import { Badge } from "@/components/ui/badge";
import { Megaphone, Pin, House, List } from "lucide-react";

export const Route = createFileRoute("/notice/$noticeId")({
  head: () => ({
    meta: [
      { title: "공지사항 상세 — 이재식국어" },
      { name: "description", content: "이재식국어 학원 공지사항 상세 내용입니다." },
      { property: "og:title", content: "공지사항 상세 — 이재식국어" },
      { property: "og:description", content: "이재식국어 학원 공지사항 상세 내용입니다." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: async ({ params }) => {
    const { notice } = await getPublicNotice({ data: { id: params.noticeId } });
    if (!notice) throw notFound();
    return notice;
  },
  component: NoticeDetailPage,
  notFoundComponent: NoticeDetailNotFound,
});

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function NoticeDetailNotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-muted/30 px-4">
      <Megaphone className="h-10 w-10 text-muted-foreground" />
      <h1 className="text-lg font-bold">공지를 찾을 수 없습니다</h1>
      <p className="text-sm text-muted-foreground">삭제되었거나 아직 게시되지 않은 공지입니다.</p>
      <Link
        to="/notice"
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium transition hover:bg-accent"
      >
        <List className="h-4 w-4" /> 공지 목록으로
      </Link>
    </div>
  );
}

function NoticeDetailPage() {
  const notice = Route.useLoaderData();
  const { data } = useQuery({
    queryKey: ["public-notice", notice.id],
    queryFn: async () => (await getPublicNotice({ data: { id: notice.id } })).notice,
    initialData: notice,
    staleTime: 60 * 1000,
  });
  const n = data ?? notice;
  const cards =
    Array.isArray(n.cards) && n.cards.length > 0
      ? n.cards
      : n.card_body
        ? [{ title: n.title, body: n.card_body }]
        : [];

  return (
    <div className="min-h-screen overflow-x-clip bg-muted/30">
      <header className="border-b border-border/60 bg-card">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              <Megaphone className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold tracking-tight">공지사항</h1>
              <p className="truncate text-xs text-muted-foreground">이재식국어 학원 안내</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              to="/notice"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium transition hover:bg-accent"
            >
              <List className="h-4 w-4" />
              <span className="hidden sm:inline">목록</span>
            </Link>
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium transition hover:bg-accent"
            >
              <House className="h-4 w-4" />
              <span className="hidden sm:inline">홈으로</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <article className="rounded-2xl border bg-card p-5 shadow-sm sm:p-8">
          <div className="flex flex-wrap items-center gap-2">
            {n.is_pinned && (
              <Badge className="gap-1">
                <Pin className="h-3 w-3" /> 중요
              </Badge>
            )}
            {n.branch && <Badge variant="secondary">{n.branch}</Badge>}
          </div>
          <h2 className="mt-2 break-words text-xl font-bold sm:text-2xl [overflow-wrap:anywhere]">
            {n.title}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">{formatDate(n.created_at)}</p>
          <div className="mt-4 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90 [overflow-wrap:anywhere]">
            {n.body}
          </div>
        </article>

        {cards.length > 0 && (
          <section className="mt-6 space-y-4">
            {cards.map((c, i) => (
              <div key={i} className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
                <h3 className="break-words text-base font-bold [overflow-wrap:anywhere]">{c.title}</h3>
                <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                  {c.body}
                </div>
              </div>
            ))}
          </section>
        )}
      </main>
    </div>
  );
}
