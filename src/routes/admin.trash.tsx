import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listTrash, listTrashCounts, restoreItem, purgeItem } from "@/lib/trash.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { RotateCcw, Trash2 } from "lucide-react";
import { useAdminRole } from "@/components/AdminRole";

export const Route = createFileRoute("/admin/trash")({
  head: () => ({ meta: [{ title: "휴지통 — 관리자" }] }),
  component: TrashPage,
});

function TrashPage() {
  const qc = useQueryClient();
  const { isAdmin } = useAdminRole();
  const getCounts = useServerFn(listTrashCounts);
  const getList = useServerFn(listTrash);
  const restore = useServerFn(restoreItem);
  const purge = useServerFn(purgeItem);

  const countsQ = useQuery({ queryKey: ["trash", "counts"], queryFn: () => getCounts() });
  const entities = (countsQ.data?.entities ?? []) as string[];
  const labels = (countsQ.data?.labels ?? {}) as Record<string, string>;
  const counts = (countsQ.data?.counts ?? {}) as Record<string, number>;

  const [active, setActive] = useState<string>("videos");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const listQ = useQuery({
    queryKey: ["trash", "list", active],
    queryFn: () => getList({ data: { entity: active as any, limit: 100, offset: 0 } }),
    enabled: !!active,
  });

  const switchTab = (e: string) => {
    setActive(e);
    setSelected(new Set());
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["trash"] });
  };

  const restoreMut = useMutation({
    mutationFn: (v: { entity: string; id: string }) =>
      restore({ data: { entity: v.entity as any, id: v.id } }),
    onSuccess: () => {
      toast.success("복원되었습니다.");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "복원 실패"),
  });

  const purgeMut = useMutation({
    mutationFn: (v: { entity: string; id: string }) =>
      purge({ data: { entity: v.entity as any, id: v.id } }),
    onSuccess: () => {
      toast.success("영구 삭제되었습니다.");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "삭제 실패"),
  });

  const bulkPurgeMut = useMutation({
    mutationFn: async (ids: string[]) => {
      let failed = 0;
      for (const id of ids) {
        try {
          await purge({ data: { entity: active as any, id } });
        } catch {
          failed += 1;
        }
      }
      return { total: ids.length, failed };
    },
    onSuccess: (r) => {
      if (r.failed > 0) {
        toast.warning(`${r.total - r.failed}건 삭제, ${r.failed}건 실패했습니다.`);
      } else {
        toast.success(`${r.total}건이 영구 삭제되었습니다.`);
      }
      setSelected(new Set());
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "삭제 실패"),
  });

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const rows = listQ.data?.rows ?? [];
  const allIds = rows.map((row: any) =>
    active === "class_students"
      ? `${row.class_id}::${row.user_id}`
      : active === "team_members"
        ? `${row.team_id}::${row.user_id}`
        : row.id,
  );
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(allIds));
  };

  const pkOf = (entity: string, row: any): string => {
    if (entity === "class_students") return `${row.class_id}::${row.user_id}`;
    if (entity === "team_members") return `${row.team_id}::${row.user_id}`;
    return row.id;
  };

  const displayOf = (entity: string, row: any): string => {
    switch (entity) {
      case "videos":
        return row.title || row.id;
      case "classes":
      case "teams":
      case "class_categories":
        return row.name || row.id;
      case "class_folders":
        return `${row.name || "폴더"} (${row.class_name || "반"})`;
      case "class_students":
        return `${row.class_name || "반"} / 학생 ${row.student_name || row.user_id}`;
      case "class_instructors":
        return `${row.class_name || "반"} / 강사 ${row.instructor_name || row.instructor_user_id}`;
      case "team_members":
        return `${row.team_name || "팀"} / ${row.member_name || row.user_id}`;
      case "comments":
        return `${(row.body ?? "").slice(0, 60) || "댓글"} (${row.video_title || "영상"})`;
      case "bookmarks":
        return `${row.note ?? "북마크"} @ ${row.seconds}s (${row.video_title || "영상"})`;
      default:
        return row.id;
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">휴지통</h1>
        <p className="text-sm text-muted-foreground">
          소프트 삭제된 항목을 복원하거나 영구 삭제할 수 있습니다.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {entities.map((e) => (
          <Button
            key={e}
            size="sm"
            variant={active === e ? "default" : "outline"}
            onClick={() => switchTab(e)}
          >
            {labels[e] ?? e}
            <span className="ml-2 rounded-full bg-background/40 px-1.5 text-xs">
              {counts[e] ?? 0}
            </span>
          </Button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={allSelected}
            onChange={toggleAll}
          />
          전체 선택{selected.size > 0 ? ` (${selected.size}건 선택됨)` : ""}
        </label>
        {selected.size > 0 && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="destructive" disabled={bulkPurgeMut.isPending}>
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                선택 항목 영구 삭제 ({selected.size})
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>선택한 {selected.size}건을 영구 삭제하시겠어요?</AlertDialogTitle>
                <AlertDialogDescription>
                  이 작업은 되돌릴 수 없습니다. 데이터베이스에서 완전히 제거됩니다.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>취소</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => bulkPurgeMut.mutate(Array.from(selected))}
                >
                  영구 삭제
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      <Card className="p-4">
        {listQ.isLoading && <p className="text-sm text-muted-foreground">불러오는 중...</p>}
        {listQ.data && listQ.data.rows.length === 0 && (
          <p className="text-sm text-muted-foreground">삭제된 항목이 없습니다.</p>
        )}
        <ul className="divide-y">
          {listQ.data?.rows.map((row: any) => {
            const id = pkOf(active, row);
            return (
              <li key={id} className="flex items-center justify-between gap-3 py-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 accent-primary"
                  checked={selected.has(id)}
                  onChange={() => toggleSelect(id)}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{displayOf(active, row)}</p>
                  <p className="text-xs text-muted-foreground">
                    삭제 {row.deleted_at ? new Date(row.deleted_at).toLocaleString("ko-KR") : "-"}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {isAdmin && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={restoreMut.isPending}
                      onClick={() => restoreMut.mutate({ entity: active, id })}
                    >
                      <RotateCcw className="mr-1 h-3.5 w-3.5" />
                      복원
                    </Button>
                  )}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="destructive">
                        <Trash2 className="mr-1 h-3.5 w-3.5" />
                        영구 삭제
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>영구 삭제하시겠어요?</AlertDialogTitle>
                        <AlertDialogDescription>
                          이 작업은 되돌릴 수 없습니다. 데이터베이스에서 완전히 제거됩니다.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>취소</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => purgeMut.mutate({ entity: active, id })}
                        >
                          영구 삭제
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
