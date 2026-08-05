import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, Plus, Trash2, Send, GraduationCap, X, MoreVertical } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ClearableSearchInput } from "@/components/admin/ClearableSearchInput";
import {
  addTeamMember,
  assignTeamToClass,
  createTeam,
  deleteTeam,
  getTeam,
  listAllClassesForAdmin,
  listTeamMessages,
  listTeams,
  removeTeamMember,
  sendTeamMessage,
  updateTeam,
} from "@/lib/teams.functions";
import { searchApprovedStudents } from "@/lib/teams.functions";

export const Route = createFileRoute("/admin/teams")({
  head: () => ({ meta: [{ title: "팀 관리 — e-Learning" }] }),
  component: TeamsPage,
});

function TeamsPage() {
  const qc = useQueryClient();
  const { data: teams = [], isLoading } = useQuery({
    queryKey: ["teams"],
    queryFn: () => listTeams(),
  });
  const [filter, setFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return teams;
    return teams.filter((t: any) => (t.name ?? "").toLowerCase().includes(q));
  }, [teams, filter]);

  const create = useMutation({
    mutationFn: () => createTeam({ data: { name: name.trim(), description: description.trim() || undefined } }),
    onSuccess: () => {
      toast.success("팀이 생성되었습니다.");
      setName("");
      setDescription("");
      setCreateOpen(false);
      qc.invalidateQueries({ queryKey: ["teams"] });
    },
    onError: (e: any) => toast.error(e.message ?? "실패"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteTeam({ data: { id } }),
    onSuccess: () => {
      toast.success("삭제되었습니다.");
      qc.invalidateQueries({ queryKey: ["teams"] });
    },
    onError: (e: any) => toast.error(e.message ?? "실패"),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">팀 관리</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            수강생을 팀으로 묶어 한 번에 수강 권한을 부여하거나 메시지를 발송할 수 있어요.
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-1 h-4 w-4" /> 팀 추가
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>새 팀 만들기</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Input placeholder="팀 이름 (예: 15기)" value={name} onChange={(e) => setName(e.target.value)} />
              <Textarea
                placeholder="설명 (선택)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>취소</Button>
              <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
                {create.isPending ? "생성 중..." : "생성"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-2xl border bg-card p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-medium">{filtered.length}팀</span>
          <ClearableSearchInput
            placeholder="팀명"
            value={filter}
            onChange={setFilter}
            className="w-full max-w-xs"
            inputClassName="pl-8"
            iconClassName="left-2"
          />
        </div>

        {isLoading ? (
          <p className="py-10 text-center text-sm text-muted-foreground">불러오는 중...</p>
        ) : filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">등록된 팀이 없습니다.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {filtered.map((t: any) => (
              <div
                key={t.id}
                className="group flex flex-col justify-between rounded-xl border bg-background p-4 transition hover:border-primary/40 hover:shadow-sm"
              >
                <div>
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {new Date(t.created_at).toLocaleDateString()}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="rounded p-1 opacity-60 hover:bg-muted hover:opacity-100">
                          <MoreVertical className="h-4 w-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => {
                            if (confirm(`"${t.name}" 팀을 삭제하시겠습니까?`)) remove.mutate(t.id);
                          }}
                        >
                          <Trash2 className="mr-2 h-4 w-4" /> 삭제
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <button
                    className="text-left text-lg font-semibold hover:text-primary"
                    onClick={() => setDetailId(t.id)}
                  >
                    {t.name}
                  </button>
                  {t.description && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{t.description}</p>
                  )}
                </div>
                <div className="mt-6 flex items-center gap-1.5 text-sm">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span className="font-semibold text-primary">{t.member_count}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {detailId && <TeamDetailDialog teamId={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

function TeamDetailDialog({ teamId, onClose }: { teamId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: team } = useQuery({
    queryKey: ["team", teamId],
    queryFn: () => getTeam({ data: { id: teamId } }),
  });
  const { data: classes = [] } = useQuery({
    queryKey: ["teams", "classes-select"],
    queryFn: () => listAllClassesForAdmin(),
  });
  const { data: messages = [] } = useQuery({
    queryKey: ["team", teamId, "messages"],
    queryFn: () => listTeamMessages({ data: { teamId } }),
  });

  const [tab, setTab] = useState<"members" | "assign" | "message" | "edit">("members");
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  const [selectedClass, setSelectedClass] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["team", teamId] });
    qc.invalidateQueries({ queryKey: ["teams"] });
  };

  const addMem = useMutation({
    mutationFn: (userId: string) => addTeamMember({ data: { teamId, userId } }),
    onSuccess: () => {
      toast.success("추가되었습니다.");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message ?? "실패"),
  });
  const removeMem = useMutation({
    mutationFn: (userId: string) => removeTeamMember({ data: { teamId, userId } }),
    onSuccess: () => {
      toast.success("제거되었습니다.");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message ?? "실패"),
  });
  const assign = useMutation({
    mutationFn: () => assignTeamToClass({ data: { teamId, classId: selectedClass } }),
    onSuccess: (r: any) => {
      toast.success(`${r.assigned}명 배정 완료`);
    },
    onError: (e: any) => toast.error(e.message ?? "실패"),
  });
  const send = useMutation({
    mutationFn: () => sendTeamMessage({ data: { teamId, subject: subject.trim(), body: body.trim() } }),
    onSuccess: () => {
      toast.success("메시지가 발송되었습니다.");
      setSubject("");
      setBody("");
      qc.invalidateQueries({ queryKey: ["team", teamId, "messages"] });
    },
    onError: (e: any) => toast.error(e.message ?? "실패"),
  });
  const saveEdit = useMutation({
    mutationFn: () =>
      updateTeam({
        data: {
          id: teamId,
          name: editName.trim() || undefined,
          description: editDesc.trim() || null,
        },
      }),
    onSuccess: () => {
      toast.success("수정되었습니다.");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message ?? "실패"),
  });

  const runSearch = async () => {
    if (!isSearchableStudentQuery(query)) {
      toast.info(STUDENT_SEARCH_HINT);
      return;
    }
    setSearching(true);

    try {
      const rows = await searchApprovedStudents({ data: { query: query.trim() } });
      const memberIds = new Set((team?.members ?? []).map((m: any) => m.user_id));
      setResults(rows.filter((r: any) => !memberIds.has(r.user_id)));
    } catch (e: any) {
      toast.error(e.message ?? "검색 실패");
    } finally {
      setSearching(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{team?.name ?? "팀"}</DialogTitle>
        </DialogHeader>

        <div className="mb-3 flex flex-wrap gap-1 border-b">
          {[
            { k: "members", l: `멤버 (${team?.members?.length ?? 0})` },
            { k: "assign", l: "수강반 일괄 배정" },
            { k: "message", l: "메시지" },
            { k: "edit", l: "설정" },
          ].map((x) => (
            <button
              key={x.k}
              onClick={() => {
                setTab(x.k as any);
                if (x.k === "edit" && team) {
                  setEditName(team.name);
                  setEditDesc(team.description ?? "");
                }
              }}
              className={`border-b-2 px-3 py-2 text-sm transition ${
                tab === x.k
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {x.l}
            </button>
          ))}
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {tab === "members" && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <ClearableSearchInput
                  placeholder="이름 또는 전화번호로 검색"
                  value={query}
                  onChange={setQuery}
                  className="flex-1"
                  showIcon={false}
                  onKeyDown={(e) => e.key === "Enter" && runSearch()}
                />
                <Button onClick={runSearch} disabled={searching}>
                  검색
                </Button>
              </div>
              {results.length > 0 && (
                <div className="rounded border">
                  {results.map((r) => (
                    <div key={r.user_id} className="flex items-center justify-between border-b px-3 py-2 last:border-b-0">
                      <div className="text-sm">
                        <span className="font-medium">{r.name}</span>{" "}
                        <span className="text-muted-foreground">{r.phone}</span>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => addMem.mutate(r.user_id)}>
                        추가
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {(team?.members ?? []).map((m: any) => (
                  <div key={m.user_id} className="flex items-center justify-between rounded border bg-card px-3 py-2">
                    <div className="text-sm">
                      <div className="font-medium">{m.name || "-"}</div>
                      <div className="text-xs text-muted-foreground">{m.phone || "-"}</div>
                    </div>
                    <button
                      className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => removeMem.mutate(m.user_id)}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                {(!team?.members || team.members.length === 0) && (
                  <p className="col-span-full py-6 text-center text-sm text-muted-foreground">
                    아직 멤버가 없습니다.
                  </p>
                )}
              </div>
            </div>
          )}

          {tab === "assign" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                이 팀의 모든 멤버({team?.members?.length ?? 0}명)를 선택한 수강반에 일괄 배정합니다.
              </p>
              <Select value={selectedClass} onValueChange={setSelectedClass}>
                <SelectTrigger>
                  <SelectValue placeholder="수강반 선택" />
                </SelectTrigger>
                <SelectContent>
                  {classes.map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                disabled={!selectedClass || assign.isPending || (team?.members?.length ?? 0) === 0}
                onClick={() => assign.mutate()}
              >
                <GraduationCap className="mr-1 h-4 w-4" />
                {assign.isPending ? "배정 중..." : "일괄 배정"}
              </Button>
            </div>
          )}

          {tab === "message" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Input placeholder="제목" value={subject} onChange={(e) => setSubject(e.target.value)} />
                <Textarea
                  placeholder="내용"
                  rows={5}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
                <Button
                  disabled={!subject.trim() || !body.trim() || send.isPending}
                  onClick={() => send.mutate()}
                >
                  <Send className="mr-1 h-4 w-4" />
                  {send.isPending ? "발송 중..." : "발송"}
                </Button>
              </div>
              <div className="space-y-2">
                <h4 className="text-sm font-semibold">발송 기록</h4>
                {messages.length === 0 && (
                  <p className="text-xs text-muted-foreground">발송된 메시지가 없습니다.</p>
                )}
                {messages.map((m: any) => (
                  <div key={m.id} className="rounded border bg-card p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{m.subject}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(m.created_at).toLocaleString()}
                      </span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{m.body}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "edit" && (
            <div className="space-y-3">
              <Input placeholder="팀명" value={editName} onChange={(e) => setEditName(e.target.value)} />
              <Textarea
                placeholder="설명"
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
              />
              <Button onClick={() => saveEdit.mutate()} disabled={saveEdit.isPending}>
                {saveEdit.isPending ? "저장 중..." : "저장"}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
