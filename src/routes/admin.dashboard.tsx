import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getOverviewStats, getClassStats } from "@/lib/stats.functions";
import { BarChart3, GraduationCap, Users, PlayCircle, CheckCircle2, TrendingUp } from "lucide-react";

export const Route = createFileRoute("/admin/dashboard")({
  component: DashboardPage,
});

function Stat({ label, value, icon: Icon }: { label: string; value: string | number; icon: any }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-4 w-4" /> {label}
      </div>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );
}

function DashboardPage() {
  const { data: overview } = useQuery({
    queryKey: ["stats", "overview"],
    queryFn: () => getOverviewStats(),
  });
  const { data: classes = [] } = useQuery({
    queryKey: ["stats", "classes"],
    queryFn: () => getClassStats(),
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">대시보드</h1>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="영상" value={overview?.videoCount ?? "-"} icon={PlayCircle} />
        <Stat label="수강반" value={overview?.classCount ?? "-"} icon={GraduationCap} />
        <Stat label="학생" value={overview?.studentCount ?? "-"} icon={Users} />
        <Stat label="총 시청 기록" value={overview?.totalViews ?? "-"} icon={BarChart3} />
        <Stat label="완료 수" value={overview?.completedCount ?? "-"} icon={CheckCircle2} />
        <Stat
          label="평균 시청률"
          value={overview ? `${Math.round(overview.avgWatchedRatio * 100)}%` : "-"}
          icon={TrendingUp}
        />
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold">수강반별 학습 현황</h2>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">수강반</th>
                <th className="px-3 py-2">학생</th>
                <th className="px-3 py-2">영상</th>
                <th className="px-3 py-2">완료율</th>
                <th className="px-3 py-2">평균 시청률</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {classes.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                    등록된 수강반이 없습니다.
                  </td>
                </tr>
              )}
              {classes.map((c: any) => (
                <tr key={c.class_id} className="border-t">
                  <td className="px-3 py-2 font-medium">{c.name}</td>
                  <td className="px-3 py-2">{c.student_count}명</td>
                  <td className="px-3 py-2">{c.video_count}개</td>
                  <td className="px-3 py-2">{Math.round(c.completion_rate * 100)}%</td>
                  <td className="px-3 py-2">{Math.round(c.avg_watched_ratio * 100)}%</td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      to="/admin/classes/$id"
                      params={{ id: c.class_id }}
                      className="text-primary hover:underline"
                    >
                      상세
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
