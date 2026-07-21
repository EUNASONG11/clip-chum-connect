import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Bookmark, Trash2 } from "lucide-react";
import { addBookmark, deleteBookmark, listMyBookmarks } from "@/lib/social.functions";
import { toast } from "sonner";

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function BookmarksPanel({
  videoId,
  getCurrentTime,
  onSeek,
}: {
  videoId: string;
  getCurrentTime: () => number;
  onSeek: (sec: number) => void;
}) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const { data: bookmarks = [] } = useQuery({
    queryKey: ["bookmarks", videoId],
    queryFn: () => listMyBookmarks({ data: { videoId } }),
  });
  const add = useMutation({
    mutationFn: () =>
      addBookmark({
        data: { videoId, seconds: Math.floor(getCurrentTime() || 0), note: note.trim() || null },
      }),
    onSuccess: () => {
      setNote("");
      toast.success("북마크 추가됨");
      qc.invalidateQueries({ queryKey: ["bookmarks", videoId] });
    },
    onError: (e: any) => toast.error(e.message ?? "북마크 실패"),
  });
  const del = useMutation({
    mutationFn: (id: string) => deleteBookmark({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bookmarks", videoId] }),
  });

  return (
    <section className="rounded-lg border p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Bookmark className="h-4 w-4" /> 내 북마크
      </h3>
      <div className="mb-3 flex gap-2">
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="메모(선택)"
          className="h-9"
        />
        <Button size="sm" onClick={() => add.mutate()} disabled={add.isPending}>
          현재 위치 저장
        </Button>
      </div>
      {bookmarks.length === 0 ? (
        <p className="text-xs text-muted-foreground">아직 북마크가 없습니다.</p>
      ) : (
        <ul className="space-y-2">
          {bookmarks.map((b: any) => (
            <li key={b.id} className="flex items-center gap-2 text-sm">
              <button
                onClick={() => onSeek(b.seconds)}
                className="rounded bg-muted px-2 py-1 font-mono text-xs hover:bg-muted/70"
              >
                {fmt(b.seconds)}
              </button>
              <span className="flex-1 truncate text-muted-foreground">{b.note || "—"}</span>
              <button
                onClick={() => del.mutate(b.id)}
                className="text-destructive hover:opacity-70"
                aria-label="삭제"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
