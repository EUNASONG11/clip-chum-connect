import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { ArrowLeft, UserPlus, X, Film, BarChart3, Search, ArrowUp, ArrowDown, GraduationCap } from "lucide-react";
import {
  getClass,
  listClassStudents,
  searchStudentsByNameOrPhone,
  assignStudent,
  unassignStudent,
  listClassVideos,
  swapVideoOrder,
  listClassInstructors,
  searchInstructors,
  assignInstructor,
  unassignInstructor,
} from "@/lib/classes.functions";
import { getClassStudentStats } from "@/lib/stats.functions";
import { useAdminRole } from "@/components/AdminRole";

export const Route = createFileRoute("/admin/classes/$id")({
  component: ClassDetailPage,
});

function ClassDetailPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const { isAdmin } = useAdminRole();
  const { data: cls } = useQuery({
    queryKey: ["admin", "class", id],
    queryFn: () => getClass({ data: { id } }),
  });
  const { data: students = [] } = useQuery({
    queryKey: ["admin", "class", id, "students"],
    queryFn: () => listClassStudents({ data: { classId: id } }),
  });
  const { data: videos = [] } = useQuery({
    queryKey: ["admin", "class", id, "videos"],
    queryFn: () => listClassVideos({ data: { classId: id } }),
  });
  const { data: studentStats = [] } = useQuery({
    queryKey: ["admin", "class", id, "student-stats"],
    queryFn: () => getClassStudentStats({ data: { classId: id } }),
  });

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<
    { user_id: string; name: string; phone: string; school: string; grade: string }[]
  >([]);
  const [searching, setSearching] = useState(false);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    try {
      const rows = await searchStudentsByNameOrPhone({ data: { query: query.trim() } });
      setResults(rows);
      if (rows.length === 0) toast.info("일치하는 학생이 없습니다.");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSearching(false);
    }
  };

  const assign = async (userId: string) => {
    try {
      await assignStudent({ data: { classId: id, userId } });
      qc.invalidateQueries({ queryKey: ["admin", "class", id, "students"] });
      setResults((r) => r.filter((s) => s.user_id !== userId));
      toast.success("배정되었습니다.");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const remove = async (userId: string) => {
    try {
      await unassignStudent({ data: { classId: id, userId } });
      qc.invalidateQueries({ queryKey: ["admin", "class", id, "students"] });
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // 강사 배정 상태
  const { data: assignedInstructors = [] } = useQuery({
    queryKey: ["admin", "class", id, "instructors"],
    queryFn: () => listClassInstructors({ data: { classId: id } }),
  });
  const [iq, setIq] = useState("");
  const [iResults, setIResults] = useState<{ user_id: string; name: string; email: string }[]>([]);
  const [iSearching, setISearching] = useState(false);

  const searchI = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!iq.trim()) return;
    setISearching(true);
    try {
      const rows = await searchInstructors({ data: { query: iq.trim() } });
      setIResults(rows);
      if (rows.length === 0) toast.info("일치하는 강사가 없습니다.");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setISearching(false);
    }
  };
  const assignI = async (userId: string) => {
    try {
      await assignInstructor({ data: { classId: id, userId } });
      qc.invalidateQueries({ queryKey: ["admin", "class", id, "instructors"] });
      setIResults((r) => r.filter((s) => s.user_id !== userId));
      toast.success("강사가 배정되었습니다.");
    } catch (err: any) {
      toast.error(err.message);
    }
  };
  const removeI = async (userId: string) => {
    try {
      await unassignInstructor({ data: { classId: id, userId } });
      qc.invalidateQueries({ queryKey: ["admin", "class", id, "instructors"] });
    } catch (err: any) {
      toast.error(err.message);
    }
  };



  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin/classes">
            <ArrowLeft className="mr-1 h-4 w-4" /> 수강반 목록
          </Link>
        </Button>
        <h1 className="mt-2 text-2xl font-bold">{cls?.name ?? "..."}</h1>
        {cls?.description && (
          <p className="mt-1 text-sm text-muted-foreground">{cls.description}</p>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" /> 학생 배정 ({students.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={search} className="flex gap-2">
            <div className="flex-1">
              <Label htmlFor="query" className="sr-only">이름 또는 전화번호</Label>
              <Input
                id="query"
                type="text"
                placeholder="이름 또는 전화번호로 검색"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={searching}>
              <Search className="mr-1 h-4 w-4" />
              {searching ? "검색 중..." : "검색"}
            </Button>
          </form>

          {results.length > 0 && (
            <div className="rounded-md border">
              <ul className="divide-y">
                {results.map((r) => {
                  const already = students.some((s: any) => s.user_id === r.user_id);
                  return (
                    <li key={r.user_id} className="flex items-center gap-2 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{r.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {r.phone}
                          {r.school ? ` · ${r.school}` : ""}
                          {r.grade ? ` ${r.grade}` : ""}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => assign(r.user_id)}
                        disabled={already}
                      >
                        {already ? "배정됨" : "배정"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {students.length === 0 ? (
            <p className="text-sm text-muted-foreground">아직 배정된 학생이 없습니다.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {students.map((s: any) => (
                <div
                  key={s.user_id}
                  className="flex items-center gap-2 rounded-md border bg-card px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{s.name || s.email}</p>
                    {s.phone && (
                      <p className="truncate text-xs text-muted-foreground">{s.phone}</p>
                    )}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0"
                    onClick={() => remove(s.user_id)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

        </CardContent>
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GraduationCap className="h-5 w-5" /> 강사 배정 ({assignedInstructors.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              배정된 강사는 이 수강반의 학생/영상/진도를 조회하고 관리할 수 있습니다.
            </p>
            <form onSubmit={searchI} className="flex gap-2">
              <div className="flex-1">
                <Label htmlFor="iquery" className="sr-only">이름 또는 이메일</Label>
                <Input
                  id="iquery"
                  type="text"
                  placeholder="강사 이름 또는 이메일로 검색"
                  value={iq}
                  onChange={(e) => setIq(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={iSearching}>
                <Search className="mr-1 h-4 w-4" />
                {iSearching ? "검색 중..." : "검색"}
              </Button>
            </form>

            {iResults.length > 0 && (
              <div className="rounded-md border">
                <ul className="divide-y">
                  {iResults.map((r) => {
                    const already = assignedInstructors.some((s: any) => s.user_id === r.user_id);
                    return (
                      <li key={r.user_id} className="flex items-center gap-2 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{r.name || "-"}</p>
                          <p className="truncate text-xs text-muted-foreground">{r.email}</p>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => assignI(r.user_id)}
                          disabled={already}
                        >
                          {already ? "배정됨" : "배정"}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {assignedInstructors.length === 0 ? (
              <p className="text-sm text-muted-foreground">아직 배정된 강사가 없습니다.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {assignedInstructors.map((s: any) => (
                  <div
                    key={s.user_id}
                    className="flex items-center gap-2 rounded-md border bg-card px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{s.name || "-"}</p>
                      <p className="truncate text-xs text-muted-foreground">{s.email}</p>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 shrink-0"
                      onClick={() => removeI(s.user_id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}



      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Film className="h-5 w-5" /> 이 수강반의 영상 ({videos.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {videos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              아직 영상이 없습니다. <Link to="/admin/upload" className="text-primary underline">업로드</Link>{" "}
              또는 <Link to="/admin/videos" className="text-primary underline">등록된 영상</Link>에서 이 수강반으로 지정하세요.
            </p>
          ) : (
            <ul className="divide-y">
              {videos.map((v: any, i: number) => (
                <li key={v.id} className="flex items-center gap-3 py-2">
                  <span className="w-6 text-xs text-muted-foreground">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{v.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {v.is_published ? "공개" : "비공개"} · {v.status}
                    </p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={i === 0}
                    onClick={async () => {
                      try {
                        await swapVideoOrder({ data: { classId: id, videoId: v.id, direction: "up" } });
                        qc.invalidateQueries({ queryKey: ["admin", "class", id, "videos"] });
                      } catch (e: any) { toast.error(e.message); }
                    }}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={i === videos.length - 1}
                    onClick={async () => {
                      try {
                        await swapVideoOrder({ data: { classId: id, videoId: v.id, direction: "down" } });
                        qc.invalidateQueries({ queryKey: ["admin", "class", id, "videos"] });
                      } catch (e: any) { toast.error(e.message); }
                    }}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" /> 학생별 학습 현황
          </CardTitle>
        </CardHeader>
        <CardContent>
          {studentStats.length === 0 ? (
            <p className="text-sm text-muted-foreground">배정된 학생이 없습니다.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-2">학생</th>
                    <th className="py-2">완료</th>
                    <th className="py-2">평균 시청률</th>
                    <th className="py-2">최근 학습</th>
                  </tr>
                </thead>
                <tbody>
                  {studentStats.map((s: any) => (
                    <tr key={s.user_id} className="border-t">
                      <td className="py-2 truncate">{s.email}</td>
                      <td className="py-2">
                        {s.completed} / {s.video_total}
                      </td>
                      <td className="py-2">{Math.round(s.avg_watched_ratio * 100)}%</td>
                      <td className="py-2 text-xs text-muted-foreground">
                        {s.last_activity ? new Date(s.last_activity).toLocaleString("ko-KR") : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
