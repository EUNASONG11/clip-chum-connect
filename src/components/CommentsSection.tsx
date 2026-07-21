import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Trash2 } from "lucide-react";
import { addComment, deleteComment, listComments } from "@/lib/social.functions";
import { toast } from "sonner";

export function CommentsSection({ videoId }: { videoId: string }) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const { data: comments = [], isLoading } = useQuery({
    queryKey: ["comments", videoId],
    queryFn: () => listComments({ data: { videoId } }),
  });
  const add = useMutation({
    mutationFn: (b: string) => addComment({ data: { videoId, body: b } }),
    onSuccess: () => {
      setBody("");
      qc.invalidateQueries({ queryKey: ["comments", videoId] });
    },
    onError: (e: any) => toast.error(e.message ?? "댓글 등록 실패"),
  });
  const del = useMutation({
    mutationFn: (id: string) => deleteComment({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["comments", videoId] }),
  });

  return (
    <section className="mt-10">
      <h2 className="mb-4 text-lg font-semibold">댓글 {comments.length > 0 && `(${comments.length})`}</h2>
      <div className="mb-6 space-y-2">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="궁금한 점이나 의견을 남겨보세요"
          rows={3}
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={!body.trim() || add.isPending}
            onClick={() => add.mutate(body.trim())}
          >
            {add.isPending ? "등록 중..." : "댓글 등록"}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">불러오는 중...</p>
      ) : comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">첫 번째 댓글을 남겨보세요.</p>
      ) : (
        <ul className="space-y-4">
          {comments.map((c: any) => (
            <li key={c.id} className="rounded-lg border p-4">
              <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{c.author_email || "익명"}</span>
                <div className="flex items-center gap-2">
                  <span>{new Date(c.created_at).toLocaleString("ko-KR")}</span>
                  {c.is_mine && (
                    <button
                      onClick={() => del.mutate(c.id)}
                      className="text-destructive hover:opacity-70"
                      aria-label="삭제"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
              <p className="whitespace-pre-wrap text-sm">{c.body}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
