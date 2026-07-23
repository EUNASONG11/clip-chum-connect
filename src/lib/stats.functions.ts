import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function isAdmin(context: any) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  return !!data;
}

async function isInstructor(context: any) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "instructor",
  });
  if (error) throw new Error(error.message);
  return !!data;
}

async function assertAdminOrInstructor(context: any) {
  const [admin, instructor] = await Promise.all([isAdmin(context), isInstructor(context)]);
  if (!admin && !instructor) throw new Error("관리자 또는 강사만 접근할 수 있습니다.");
}

async function assertOwnClassOrAdmin(context: any, classId: string) {
  const admin = await isAdmin(context);
  if (admin) return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("classes")
    .select("created_by")
    .eq("id", classId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.created_by !== context.userId) {
    throw new Error("해당 수강반에 대한 권한이 없습니다.");
  }
}

// 전체 요약 통계
export const getOverviewStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const [videos, classes, students, progress] = await Promise.all([
      context.supabase.from("videos").select("id", { count: "exact", head: true }),
      context.supabase.from("classes").select("id", { count: "exact", head: true }),
      context.supabase.from("user_roles").select("id", { count: "exact", head: true }).eq("role", "student"),
      context.supabase.from("video_progress").select("watched_ratio, is_completed"),
    ]);
    const progressRows = progress.data ?? [];
    const totalViews = progressRows.length;
    const completed = progressRows.filter((r: any) => r.is_completed).length;
    const avgRatio =
      totalViews > 0
        ? progressRows.reduce((sum: number, r: any) => sum + Number(r.watched_ratio ?? 0), 0) / totalViews
        : 0;
    return {
      videoCount: videos.count ?? 0,
      classCount: classes.count ?? 0,
      studentCount: students.count ?? 0,
      totalViews,
      completedCount: completed,
      avgWatchedRatio: avgRatio,
    };
  });

// 수강반별 통계
export const getClassStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const [{ data: classes }, { data: videos }, { data: students }, { data: progress }] = await Promise.all([
      context.supabase.from("classes").select("id, name").order("created_at", { ascending: false }),
      context.supabase.from("videos").select("id, class_id"),
      context.supabase.from("class_students").select("class_id, user_id"),
      context.supabase.from("video_progress").select("video_id, user_id, watched_ratio, is_completed"),
    ]);

    const videosByClass = new Map<string, string[]>();
    (videos ?? []).forEach((v: any) => {
      if (!v.class_id) return;
      if (!videosByClass.has(v.class_id)) videosByClass.set(v.class_id, []);
      videosByClass.get(v.class_id)!.push(v.id);
    });
    const studentsByClass = new Map<string, string[]>();
    (students ?? []).forEach((s: any) => {
      if (!studentsByClass.has(s.class_id)) studentsByClass.set(s.class_id, []);
      studentsByClass.get(s.class_id)!.push(s.user_id);
    });
    const progressByVideoUser = new Map<string, any>();
    (progress ?? []).forEach((p: any) => {
      progressByVideoUser.set(`${p.video_id}:${p.user_id}`, p);
    });

    return (classes ?? []).map((c: any) => {
      const vids = videosByClass.get(c.id) ?? [];
      const studs = studentsByClass.get(c.id) ?? [];
      const totalCells = vids.length * studs.length;
      let completedCells = 0;
      let sumRatio = 0;
      let cellsWithProgress = 0;
      vids.forEach((vid) => {
        studs.forEach((uid) => {
          const p = progressByVideoUser.get(`${vid}:${uid}`);
          if (p) {
            cellsWithProgress += 1;
            sumRatio += Number(p.watched_ratio ?? 0);
            if (p.is_completed) completedCells += 1;
          }
        });
      });
      return {
        class_id: c.id,
        name: c.name,
        video_count: vids.length,
        student_count: studs.length,
        total_cells: totalCells,
        completed_cells: completedCells,
        completion_rate: totalCells > 0 ? completedCells / totalCells : 0,
        avg_watched_ratio: cellsWithProgress > 0 ? sumRatio / cellsWithProgress : 0,
      };
    });
  });

// 특정 수강반 학생별 상세
export const getClassStudentStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ classId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const [{ data: videos }, { data: students }, { data: progress }] = await Promise.all([
      context.supabase.from("videos").select("id, title").eq("class_id", data.classId),
      context.supabase.from("class_students").select("user_id").eq("class_id", data.classId),
      context.supabase.from("video_progress").select("video_id, user_id, watched_ratio, is_completed, updated_at"),
    ]);
    const videoIds = new Set((videos ?? []).map((v: any) => v.id));
    const studentIds = (students ?? []).map((s: any) => s.user_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: users } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
    const emailById = new Map(users.users.map((u) => [u.id, u.email ?? ""]));

    const rel = (progress ?? []).filter((p: any) => videoIds.has(p.video_id));
    return studentIds.map((uid) => {
      const mine = rel.filter((p: any) => p.user_id === uid);
      const completed = mine.filter((p: any) => p.is_completed).length;
      const avg = mine.length > 0
        ? mine.reduce((s: number, p: any) => s + Number(p.watched_ratio ?? 0), 0) / videoIds.size
        : 0;
      const lastActivity = mine.reduce(
        (max: string | null, p: any) => (!max || p.updated_at > max ? p.updated_at : max),
        null as string | null,
      );
      return {
        user_id: uid,
        email: emailById.get(uid) ?? "",
        video_total: videoIds.size,
        completed,
        avg_watched_ratio: Math.min(1, avg),
        last_activity: lastActivity,
      };
    });
  });
