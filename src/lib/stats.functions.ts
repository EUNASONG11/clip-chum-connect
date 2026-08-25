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

// 역할 조회를 1회 쿼리로 처리 (has_role RPC 2회 호출 대체)
async function roleFlags(context: any) {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
  const roles = new Set(((data ?? []) as any[]).map((r: any) => r.role));
  const flags = { admin: roles.has("admin"), instructor: roles.has("instructor") };
  if (!flags.admin && !flags.instructor) {
    throw new Error("관리자 또는 강사만 접근할 수 있습니다.");
  }
  return flags;
}


async function assertOwnClassOrAdmin(context: any, classId: string) {
  const admin = await isAdmin(context);
  if (admin) return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("classes")
    .select("created_by, category_id")
    .eq("id", classId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("수강반을 찾을 수 없습니다.");
  if (data.created_by === context.userId) return;
  const { data: assigned, error: aErr } = await supabaseAdmin
    .from("class_instructors")
    .select("class_id")
    .eq("class_id", classId)
    .eq("instructor_user_id", context.userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (aErr) throw new Error(aErr.message);
  if (assigned) return;
  // 카테고리에 기수가 지정된 경우, 같은 기수의 강사도 접근 허용
  if ((data as any).category_id) {
    const [{ data: cat }, { data: me }] = await Promise.all([
      supabaseAdmin
        .from("class_categories")
        .select("cohort")
        .eq("id", (data as any).category_id)
        .is("deleted_at", null)
        .maybeSingle(),
      supabaseAdmin
        .from("instructors")
        .select("cohort, cohorts")
        .eq("auth_user_id", context.userId)
        .maybeSingle(),
    ]);
    const catCohort = (cat as any)?.cohort as string | null | undefined;
    const myCohorts: string[] = [
      ...(((me as any)?.cohorts ?? []) as string[]),
      ...((me as any)?.cohort ? [(me as any).cohort as string] : []),
    ];
    if (catCohort && myCohorts.includes(catCohort)) return;
  }
  throw new Error("해당 수강반에 대한 권한이 없습니다.");
}


// 전체 요약 통계 (관리자: 전체, 강사: 본인 수강반 기준)
export const getOverviewStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { admin } = await roleFlags(context);

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

    const { data: agg, error: aggErr } = await supabaseAdmin.rpc("overview_stats_agg", {
      _class_ids: classIds,
    });
    if (aggErr) throw new Error(aggErr.message);
    const row: any = Array.isArray(agg) ? agg[0] : agg;
    const totalViews = Number(row?.total_views ?? 0);

    return {
      videoCount: Number(row?.video_count ?? 0),
      classCount: classIds.length,
      studentCount: Number(row?.student_count ?? 0),
      totalViews,
      completedCount: Number(row?.completed_count ?? 0),
      avgWatchedRatio: totalViews > 0 ? Number(row?.sum_ratio ?? 0) / totalViews : 0,
    };
  });


// 수강반별 통계 (관리자: 전체, 강사: 본인 수강반)
export const getClassStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { admin } = await roleFlags(context);

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

    const { data: agg, error: aggErr } = await supabaseAdmin.rpc("class_stats_agg", {
      _class_ids: classIds,
    });
    if (aggErr) throw new Error(aggErr.message);

    const aggMap = new Map<string, any>(((agg ?? []) as any[]).map((r: any) => [r.class_id, r]));

    return (classes ?? []).map((c: any) => {
      const a: any = aggMap.get(c.id);
      const totalCells = Number(a?.total_cells ?? 0);
      const completedCells = Number(a?.completed_cells ?? 0);
      const sumRatio = Number(a?.sum_ratio ?? 0);
      return {
        class_id: c.id,
        name: c.name,
        video_count: Number(a?.video_count ?? 0),
        student_count: Number(a?.student_count ?? 0),
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
    const { data: agg, error: aggErr } = await supabaseAdmin.rpc("class_student_stats_agg", {
      _class_id: data.classId,
    });
    if (aggErr) throw new Error(aggErr.message);
    const rows = (agg ?? []) as any[];
    const studentIds = rows.map((r: any) => r.user_id);

    const [{ data: ext }, { data: me }] = await Promise.all([
      supabaseAdmin
        .from("external_students")
        .select("auth_user_id, name, phone, branch")
        .in("auth_user_id", studentIds.length > 0 ? studentIds : ["00000000-0000-0000-0000-000000000000"]),
      supabaseAdmin
        .from("instructors")
        .select("branch, all_branches")
        .eq("auth_user_id", context.userId)
        .maybeSingle(),
    ]);
    const extMap = new Map(((ext ?? []) as any[]).map((e: any) => [e.auth_user_id, e]));
    // 전체 교육원 조회 허용 강사는 교육원 자동 필터를 적용하지 않음
    const myBranch = (me as any)?.all_branches === true
      ? ""
      : ((me as any)?.branch ?? "").toString().trim();

    const list = rows.map((r: any) => {
      const total = Number(r.video_total ?? 0);
      const avg = total > 0 ? Number(r.sum_ratio ?? 0) / total : 0;
      const e: any = extMap.get(r.user_id);
      return {
        user_id: r.user_id,
        name: e?.name ?? "",
        phone: e?.phone ?? "",
        branch: e?.branch ?? "",
        video_total: total,
        completed: Number(r.completed ?? 0),
        avg_watched_ratio: Math.min(1, avg),
        last_activity: r.last_activity ?? null,
        enrolled_at: r.enrolled_at ?? null,
      };
    });

    // 이름 기준 정렬 (교육원은 UI 필터로 선택)
    list.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "ko"));

    return list.map((r) => ({ ...r, my_branch: myBranch }));
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
        .order("created_at", { ascending: true }),
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
      .select("video_id, watched_ratio, watched_seconds, seek_attempts, max_seconds, current_seconds, duration, is_completed, completed_at, updated_at")
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
        watched_seconds: Number(p?.watched_seconds ?? 0),
        seek_attempts: Number(p?.seek_attempts ?? 0),
        max_seconds: p?.max_seconds ?? 0,
        is_completed: !!p?.is_completed,
        completed_at: p?.completed_at ?? null,
        updated_at: p?.updated_at ?? null,
      };
    });
  });

// 특정 학생의 특정 영상 건너뛰기 시도 상세 로그
export const listStudentSeekEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        classId: z.string().uuid(),
        userId: z.string().uuid(),
        videoId: z.string().uuid(),
        limit: z.number().int().min(1).max(200).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertOwnClassOrAdmin(context, data.classId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("video_seek_events")
      .select("id, from_seconds, to_seconds, blocked, created_at")
      .eq("user_id", data.userId)
      .eq("video_id", data.videoId)
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 50);
    if (error) throw new Error(error.message);
    return (rows ?? []) as any[];
  });

