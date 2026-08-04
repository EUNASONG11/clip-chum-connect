import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BranchBadge } from "@/components/BranchBadge";
import { Loader2, MessageSquare, RefreshCw, CheckCircle2, XCircle } from "lucide-react";
import { listClassSmsLogs } from "@/lib/sms.functions";

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatPhone(p: string) {
  if (p.length === 11) return `${p.slice(0, 3)}-${p.slice(3, 7)}-${p.slice(7)}`;
  if (p.length === 10) return `${p.slice(0, 3)}-${p.slice(3, 6)}-${p.slice(6)}`;
  return p;
}

export function SmsLogPanel({ classId }: { classId: string }) {
  const { data: batches = [], isFetching, refetch } = useQuery({
    queryKey: ["class-sms-logs", classId],
    queryFn: () => listClassSmsLogs({ data: { classId } }),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex min-w-0 items-center gap-2">
            <MessageSquare className="h-5 w-5 shrink-0" />
            <span className="truncate">문자 전송 이력 ({batches.length}건)</span>
          </CardTitle>
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-4 w-4" />
            )}
            새로고침
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isFetching && batches.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">불러오는 중...</p>
        )}
        {!isFetching && batches.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            아직 전송된 문자가 없습니다.
          </p>
        )}
        {batches.length > 0 && (
          <Accordion type="multiple" className="flex flex-col gap-2">
            {batches.map((b: any) => (
              <AccordionItem
                key={b.batch_id}
                value={b.batch_id}
                className="rounded-lg border px-3"
              >
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5 pr-2 text-left">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">
                        {b.channel === "brandtalk" ? "브랜드톡" : "문자(SMS)"}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(b.created_at)}
                      </span>
                      {b.sender_name && (
                        <span className="text-xs text-muted-foreground">· {b.sender_name}</span>
                      )}
                      <Badge
                        variant={b.fail_count === 0 ? "default" : "destructive"}
                        className="text-xs"
                      >
                        성공 {b.success_count} / 대상 {b.total}
                      </Badge>
                      {b.fail_count > 0 && (
                        <Badge variant="destructive" className="text-xs">
                          실패 {b.fail_count}
                        </Badge>
                      )}
                    </div>
                    <p className="line-clamp-2 text-sm">{b.message}</p>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="mb-3 whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-sm">
                    {b.message}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {b.recipients.map((r: any) => (
                      <div
                        key={r.id}
                        className="flex min-w-[200px] flex-1 items-center gap-2 rounded-md border p-2 text-sm"
                      >
                        {r.success ? (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
                        ) : (
                          <XCircle className="h-4 w-4 shrink-0 text-destructive" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate font-medium">{r.name || "이름 없음"}</span>
                            {r.branch && <BranchBadge branch={r.branch} />}
                          </div>
                          <p className="truncate text-xs text-muted-foreground">
                            {formatPhone(r.phone)}
                          </p>
                          {!r.success && r.error_message && (
                            <p className="mt-0.5 line-clamp-2 text-xs text-destructive">
                              {r.error_message}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </CardContent>
    </Card>
  );
}
