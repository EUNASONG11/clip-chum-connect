import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { listPublicNotices } from "@/lib/notices.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Megaphone, Pin } from "lucide-react";

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

function NoticePage() {
  const { data, isLoading } = useQuery({
    queryKey: ["public-notices"],
    queryFn: () => listPublicNotices(),
    staleTime: 60 * 1000,
  });

  const notices = data?.notices ?? [];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-6 py-5">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary">
            <Megaphone className="h-4 w-4" />
          </span>
          <div>
            <h1 className="text-lg font-bold tracking-tight">공지사항</h1>
            <p className="text-xs text-muted-foreground">이재식국어 학원 안내</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        {isLoading ? (
          <p className="py-16 text-center text-sm text-muted-foreground">불러오는 중…</p>
        ) : notices.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            등록된 공지사항이 없습니다.
          </p>
        ) : (
          <Card className="p-2">
            <Accordion type="multiple" className="w-full">
              {notices.map((n) => (
                <AccordionItem key={n.id} value={n.id}>
                  <AccordionTrigger className="px-3 text-left">
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                      {n.is_pinned && (
                        <Badge className="gap-1">
                          <Pin className="h-3 w-3" /> 중요
                        </Badge>
                      )}
                      {n.branch && <Badge variant="secondary">{n.branch}</Badge>}
                      <span className="truncate font-medium">{n.title}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {formatDate(n.created_at)}
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="whitespace-pre-wrap px-3 text-sm leading-relaxed text-muted-foreground">
                    {n.body || "내용이 없습니다."}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </Card>
        )}
      </main>
    </div>
  );
}
