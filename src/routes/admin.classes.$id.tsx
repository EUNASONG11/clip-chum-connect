import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { ArrowLeft, UserPlus, X, Film, BarChart3 } from "lucide-react";
import {
  getClass,
  listClassStudents,
  assignStudentByEmail,
  unassignStudent,
  listClassVideos,
} from "@/lib/classes.functions";
import { getClassStudentStats } from "@/lib/stats.functions";

export const Route = createFileRoute("/admin/classes/$id")({
  component: ClassDetailPage,
});

function ClassDetailPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
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

  const [email, setEmail] = useState("");
  const [assigning, setAssigning] = useState(false);

  const assign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setAssigning(true);
    try {
      await assignStudentByEmail({ data: { classId: id, email: email.trim() } });
      setEmail("");
      qc.invalidateQueries({ queryKey: ["admin", "class", id, "students"] });
      toast.success("배정되었습니다.");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setAssigning(false);
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
          <form onSubmit={assign} className="flex gap-2">
            <div className="flex-1">
              <Label htmlFor="email" className="sr-only">이메일</Label>
              <Input
                id="email"
                type="email"
                placeholder="학생 이메일"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={assigning}>
              {assigning ? "배정 중..." : "배정"}
            </Button>
          </form>

          {students.length === 0 ? (
            <p className="text-sm text-muted-foreground">아직 배정된 학생이 없습니다.</p>
          ) : (
            <ul className="divide-y">
              {students.map((s: any) => (
                <li key={s.user_id} className="flex items-center gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{s.email}</p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => remove(s.user_id)}>
                    <X className="h-4 w-4" />
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
              {videos.map((v: any) => (
                <li key={v.id} className="flex items-center gap-3 py-2">
                  <span className="w-6 text-xs text-muted-foreground">{v.sort_order}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{v.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {v.is_published ? "공개" : "비공개"} · {v.status}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
