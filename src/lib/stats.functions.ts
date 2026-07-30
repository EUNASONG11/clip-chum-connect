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
  if (data && data.created_by === context.userId) return;
  const { data: assigned, error: aErr } = await supabaseAdmin
    .from("class_instructors")
    .select("class_id")
    .eq("class_id", classId)
    .eq("instructor_user_id", context.userId)
    .maybeSingle();
  if (aErr) throw new Error(aErr.message);
  if (!assigned) throw new Error("해당 수강반에 대한 권한이 없습니다.");
}

// 전체 요약 통계 (관리자: 전체, 강사: 본인 수강반 기준)
export const getOverviewStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminOrInstructor(context);
    const admin = await isAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let classIds: string[] = [];
    if (admin) {
      const { data } = await supabaseAdmin.from("classes").select("id");
      classIds = (data ?? []).map((c: any) => c.id);
    } else {
      const [owned, assigned] = await Promise.all([
        supabaseAdmin.from("classes").select("id").eq("created_by", context.userId),
        supabaseAdmin
          .from("class_instructors")
          .select("class_id")
          .eq("instructor_user_id", context.userId),
      ]);
      const set = new Set<string>();
      (owned.data ?? []).forEach((c: any) => set.add(c.id));
      (assigned.data ?? []).forEach((c: any) => set.add(c.class_id));
      classIds = Array.from(set);
    }

    if (classIds.length === 0) {
      return {
        videoCount: 0,
        classCount: 0,
        studentCount: 0,
        totalViews: 0,
        completedCount: 0,
        avgWatchedRatio: 0,
      };
    }

    const [videos, students, progress] = await Promise.all([
      supabaseAdmin.from("videos").select("id", { count: "exact", head: true }).in("class_id", classIds),
      supabaseAdmin
        .from("class_students")
        .select("user_id")
        .in("class_id", classIds)
        .then((res: any) => {
          const ids = new Set((res.data ?? []).map((r: any) => r.user_id));
          return { count: ids.size };
        }),
      supabaseAdmin
        .from("videos")
        .select("id")
        .in("class_id", classIds)
        .then(async (res: any) => {
          const ids = (res.data ?? []).map((v: any) => v.id);
          if (ids.length === 0) return { data: [] };
          return supabaseAdmin
            .from("video_progress")
            .select("watched_ratio, is_completed")
            .in("video_id", ids);
        }),
    ]);

    const progressRows = (progress as any).data ?? [];
    const totalViews = progressRows.length;
    const completed = progressRows.filter((r: any) => r.is_completed).length;
    const avgRatio =
      totalViews > 0
        ? progressRows.reduce((sum: number, r: any) => sum + Number(r.watched_ratio ?? 0), 0) / totalViews
        : 0;

    return {
      videoCount: videos.count ?? 0,
      classCount: classIds.length,
      studentCount: students.count ?? 0,
      totalViews,
      completedCount: completed,
      avgWatchedRatio: avgRatio,
    };
  });

// 수강반별 통계 (관리자: 전체, 강사: 본인 수강반)
export const getClassStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminOrInstructor(context);
    const admin = await isAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let allowedIds: string[] | null = null;
    if (!admin) {
      const [owned, assigned] = await Promise.all([
        supabaseAdmin.from("classes").select("id").eq("created_by", context.userId),
        supabaseAdmin
          .from("class_instructors")
          .select("class_id")
          .eq("instructor_user_id", context.userId),
      ]);
      const set = new Set<string>();
      (owned.data ?? []).forEach((c: any) => set.add(c.id));
      (assigned.data ?? []).forEach((c: any) => set.add(c.class_id));
      allowedIds = Array.from(set);
      if (allowedIds.length === 0) return [];
    }

    let classQuery = supabaseAdmin
      .from("classes")
      .select("id, name")
      .order("created_at", { ascending: false });
    if (allowedIds) classQuery = classQuery.in("id", allowedIds);
    const { data: classes } = await classQuery;
    const classIds = (classes ?? []).map((c: any) => c.id);

    if (classIds.length === 0) return [];

    const [{ data: videos }, { data: students }, { data: progress }, { data: history }] = await Promise.all([
      supabaseAdmin.from("videos").select("id, class_id, created_at").in("class_id", classIds),
      supabaseAdmin.from("class_students").select("class_id, user_id").in("class_id", classIds),
      supabaseAdmin
        .from("videos")
        .select("id")
        .in("class_id", classIds)
        .then(async (res: any) => {
          const videoIds = (res.data ?? []).map((v: any) => v.id);
          if (videoIds.length === 0) return { data: [] };
          return supabaseAdmin
            .from("video_progress")
            .select("video_id, user_id, watched_ratio, is_completed")
            .in("video_id", videoIds);
        }),
      supabaseAdmin
        .from("class_enrollment_history")
        .select("class_id, user_id, action, created_at")
        .in("class_id", classIds)
        .eq("action", "added"),
    ]);

    const videosByClass = new Map<string, { id: string; created_at: string }[]>();
    (videos ?? []).forEach((v: any) => {
      if (!v.class_id) return;
      if (!videosByClass.has(v.class_id)) videosByClass.set(v.class_id, []);
      videosByClass.get(v.class_id)!.push({ id: v.id, created_at: v.created_at });
    });
    const studentsByClass = new Map<string, string[]>();
    (students ?? []).forEach((s: any) => {
      if (!studentsByClass.has(s.class_id)) studentsByClass.set(s.class_id, []);
      studentsByClass.get(s.class_id)!.push(s.user_id);
    });
    // 학생별 현재 배정 시작일 = 마지막 added 이벤트 시각
    const enrollStart = new Map<string, string>();
    (history ?? []).forEach((h: any) => {
      const key = `${h.class_id}:${h.user_id}`;
      const prev = enrollStart.get(key);
      if (!prev || h.created_at > prev) enrollStart.set(key, h.created_at);
    });
    const progressByVideoUser = new Map<string, any>();
    (progress ?? []).forEach((p: any) => {
      progressByVideoUser.set(`${p.video_id}:${p.user_id}`, p);
    });

    return (classes ?? []).map((c: any) => {
      const vids = videosByClass.get(c.id) ?? [];
      const studs = studentsByClass.get(c.id) ?? [];
      let totalCells = 0;
      let completedCells = 0;
      let sumRatio = 0;
      let cellsWithProgress = 0;
      studs.forEach((uid: string) => {
        const start = enrollStart.get(`${c.id}:${uid}`);
        const eligible = start ? vids.filter((v) => v.created_at >= start) : vids;
        totalCells += eligible.length;
        eligible.forEach((v) => {
          const p = progressByVideoUser.get(`${v.id}:${uid}`);
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
        avg_watched_ratio: totalCells > 0 ? sumRatio / totalCells : 0,
      };
    });
  });


// 특정 수강반 학생별 상세 (관리자: 전체, 강사: 본인 수강반)
export const getClassStudentStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ classId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertOwnClassOrAdmin(context, data.classId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: videos }, { data: students }, { data: progress }, { data: history }] = await Promise.all([
      supabaseAdmin.from("videos").select("id, title, created_at").eq("class_id", data.classId),
      supabaseAdmin.from("class_students").select("user_id").eq("class_id", data.classId),
      supabaseAdmin
        .from("videos")
        .select("id")
        .eq("class_id", data.classId)
        .then(async (res: any) => {
          const ids = (res.data ?? []).map((v: any) => v.id);
          if (ids.length === 0) return { data: [] };
          return supabaseAdmin
            .from("video_progress")
            .select("video_id, user_id, watched_ratio, is_completed, updated_at")
            .in("video_id", ids);
        }),
      supabaseAdmin
        .from("class_enrollment_history")
        .select("user_id, action, created_at")
        .eq("class_id", data.classId)
        .eq("action", "added"),
    ]);
    const videoList = (videos ?? []) as { id: string; created_at: string }[];
    const videoIds = new Set(videoList.map((v) => v.id));
    const studentIds = ((students ?? []) as any[]).map((s: any) => s.user_id);
    const { data: ext } = await supabaseAdmin
      .from("external_students")
      .select("auth_user_id, name, phone")
      .in("auth_user_id", studentIds.length > 0 ? studentIds : ["00000000-0000-0000-0000-000000000000"]);
    const extMap = new Map(((ext ?? []) as any[]).map((e: any) => [e.auth_user_id, e]));

    // 학생별 현재 배정 시작일
    const enrollStart = new Map<string, string>();
    ((history ?? []) as any[]).forEach((h: any) => {
      const prev = enrollStart.get(h.user_id);
      if (!prev || h.created_at > prev) enrollStart.set(h.user_id, h.created_at);
    });

    const rel = ((progress ?? []) as any[]).filter((p: any) => videoIds.has(p.video_id));
    return studentIds.map((uid) => {
      const start = enrollStart.get(uid);
      const eligibleVideoIds = new Set(
        start ? videoList.filter((v) => v.created_at >= start).map((v) => v.id) : videoList.map((v) => v.id),
      );
      const eligibleTotal = eligibleVideoIds.size;
      const mine = rel.filter((p: any) => p.user_id === uid && eligibleVideoIds.has(p.video_id));
      const completed = mine.filter((p: any) => p.is_completed).length;
      const avg = eligibleTotal > 0
        ? mine.reduce((s: number, p: any) => s + Number(p.watched_ratio ?? 0), 0) / eligibleTotal
        : 0;
      const lastActivity = mine.reduce(
        (max: string | null, p: any) => (!max || p.updated_at > max ? p.updated_at : max),
        null as string | null,
      );
      const e: any = extMap.get(uid);
      return {
        user_id: uid,
        name: e?.name ?? "",
        phone: e?.phone ?? "",
        video_total: eligibleTotal,
        completed,
        avg_watched_ratio: Math.min(1, avg),
        last_activity: lastActivity,
        enrolled_at: start ?? null,
      };
    });
  });


// 특정 학생의 수강반 내 영상별 시청 상세
export const getStudentVideoDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ classId: z.string().uuid(), userId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertOwnClassOrAdmin(context, data.classId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: videos }, { data: history }] = await Promise.all([
      supabaseAdmin
        .from("videos")
        .select("id, title, duration, created_at, sort_order")
        .eq("class_id", data.classId)
        .is("deleted_at", null)
        .order("sort_order", { ascending: true }),
      supabaseAdmin
        .from("class_enrollment_history")
        .select("created_at")
        .eq("class_id", data.classId)
        .eq("user_id", data.userId)
        .eq("action", "added"),
    ]);

    const start = ((history ?? []) as any[]).reduce(
      (max: string | null, h: any) => (!max || h.created_at > max ? h.created_at : max),
      null as string | null,
    );
    const list = ((videos ?? []) as any[]).filter((v: any) => (start ? v.created_at >= start : true));
    if (list.length === 0) return [];

    const { data: progress } = await supabaseAdmin
      .from("video_progress")
      .select("video_id, watched_ratio, max_seconds, current_seconds, duration, is_completed, completed_at, updated_at")
      .eq("user_id", data.userId)
      .in("video_id", list.map((v: any) => v.id));

    const pMap = new Map(((progress ?? []) as any[]).map((p: any) => [p.video_id, p]));
    return list.map((v: any) => {
      const p: any = pMap.get(v.id);
      return {
        video_id: v.id,
        title: v.title,
        duration: v.duration ?? p?.duration ?? null,
        watched_ratio: p ? Math.min(1, Number(p.watched_ratio ?? 0)) : 0,
        max_seconds: p?.max_seconds ?? 0,
        is_completed: !!p?.is_completed,
        completed_at: p?.completed_at ?? null,
        updated_at: p?.updated_at ?? null,
      };
    });
  });
