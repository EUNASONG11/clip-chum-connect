import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { compareOrderKeys, orderKeyOf } from "@/lib/video-order";
import { z } from "zod";

async function isAdmin(context: any) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
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
  const flags = {
    admin: roles.has("admin"),
    instructor: roles.has("instructor"),
    branchAdmin: roles.has("branch_admin"),
  };
  if (!flags.admin && !flags.instructor && !flags.branchAdmin) {
    throw new Error("관리자 또는 강사만 접근할 수 있습니다.");
  }
  return flags;
}


// 교육원 관리자가 담당하는 교육원의 수강반 id 목록
async function branchAdminClassIds(context: any, supabaseAdmin: any) {
  const { data: branch } = await context.supabase.rpc("branch_admin_branch", {
    _uid: context.userId,
  });
  const b = ((branch as string | null) ?? "").trim();
  if (!b) return [] as string[];
  const { data } = await supabaseAdmin
    .from("classes")
    .select("id")
    .or(`branch.eq.${b},branch.is.null`)
    .is("deleted_at", null);
  return ((data ?? []) as any[]).map((c: any) => c.id as string);
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
    const { admin, branchAdmin } = await roleFlags(context);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let classIds: string[] = [];
    if (admin) {
      const { data } = await supabaseAdmin.from("classes").select("id").is("deleted_at", null);
      classIds = (data ?? []).map((c: any) => c.id);
    } else {
      const [owned, assigned] = await Promise.all([
        supabaseAdmin
          .from("classes")
          .select("id")
          .eq("created_by", context.userId)
          .is("deleted_at", null),
        supabaseAdmin
          .from("class_instructors")
          .select("class_id")
          .eq("instructor_user_id", context.userId)
          .is("deleted_at", null),
      ]);
      const set = new Set<string>();
      (owned.data ?? []).forEach((c: any) => set.add(c.id));
      (assigned.data ?? []).forEach((c: any) => set.add(c.class_id));
      if (branchAdmin) {
        (await branchAdminClassIds(context, supabaseAdmin)).forEach((id) => set.add(id));
      }
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
    const { admin, branchAdmin } = await roleFlags(context);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let allowedIds: string[] | null = null;
    if (!admin) {
      const [owned, assigned] = await Promise.all([
        supabaseAdmin
          .from("classes")
          .select("id")
          .eq("created_by", context.userId)
          .is("deleted_at", null),
        supabaseAdmin
          .from("class_instructors")
          .select("class_id")
          .eq("instructor_user_id", context.userId)
          .is("deleted_at", null),
      ]);
      const set = new Set<string>();
      (owned.data ?? []).forEach((c: any) => set.add(c.id));
      (assigned.data ?? []).forEach((c: any) => set.add(c.class_id));
      if (branchAdmin) {
        (await branchAdminClassIds(context, supabaseAdmin)).forEach((id) => set.add(id));
      }
      allowedIds = Array.from(set);
      if (allowedIds.length === 0) return [];
    }

    let classQuery = supabaseAdmin
      .from("classes")
      .select("id, name")
      .is("deleted_at", null)
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
  .inputValidator((i) =>
    z
      .object({
        classId: z.string().uuid(),
        from: z.string().optional(),
        to: z.string().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertOwnClassOrAdmin(context, data.classId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // 기간 필터: 영상 등록일(created_at) 기준 [from 00:00, to+1일 00:00) — KST 기준으로 해석
    const fromTs = data.from ? new Date(`${data.from}T00:00:00+09:00`).toISOString() : undefined;
    const toTs = data.to ? new Date(`${data.to}T00:00:00+09:00`).toISOString() : undefined;
    const toExclusive = toTs
      ? new Date(new Date(toTs).getTime() + 24 * 60 * 60 * 1000).toISOString()
      : undefined;
    const { data: agg, error: aggErr } = await supabaseAdmin.rpc(
      "class_student_stats_agg_range",
      {
        _class_id: data.classId,
        _from: fromTs,
        _to: toExclusive,
      },
    );
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

    const [{ data: videos }, { data: history }, { data: folders }, { data: enrollRow }] = await Promise.all([
      supabaseAdmin
        .from("videos")
        .select("id, title, duration, created_at, sort_order, folder_id")
        .eq("class_id", data.classId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true }),
      supabaseAdmin
        .from("class_enrollment_history")
        .select("created_at")
        .eq("class_id", data.classId)
        .eq("user_id", data.userId)
        .eq("action", "added"),
      supabaseAdmin
        .from("class_folders")
        .select("id, name, parent_folder_id, sort_order, is_required")
        .eq("class_id", data.classId)
        .is("deleted_at", null)
        .order("sort_order", { ascending: true }),
      supabaseAdmin
        .from("class_students")
        .select("progress_start_at, progress_start_video_id")
        .eq("class_id", data.classId)
        .eq("user_id", data.userId)
        .is("deleted_at", null)
        .maybeSingle(),
    ]);

    const folderById = new Map<string, any>(((folders ?? []) as any[]).map((f: any) => [f.id, f]));
    const folderPath = (fid: string | null) => {
      if (!fid) return null;
      const parts: string[] = [];
      let cur: any = folderById.get(fid);
      let guard = 0;
      while (cur && guard++ < 20) {
        parts.unshift(cur.name);
        cur = cur.parent_folder_id ? folderById.get(cur.parent_folder_id) : null;
      }
      return parts.length > 0 ? parts.join(" / ") : null;
    };

    // 시작 영상이 id로 설정돼 있으면 화면 표시 순서(폴더 순서 → 폴더 안 영상 순서) 기준으로
    // 그 영상부터 포함. 아니면 기존처럼 배정/시작 시각 기준.
    const startVideoId = (enrollRow as any)?.progress_start_video_id as string | null;
    const startVideo = startVideoId
      ? ((videos ?? []) as any[]).find((v: any) => v.id === startVideoId)
      : null;
    let list: any[];
    if (startVideo) {
      const folderSortMap = new Map<string, number>(
        ((folders ?? []) as any[]).map((f: any) => [f.id as string, Number(f.sort_order ?? 9999)]),
      );
      const startKey = orderKeyOf(startVideo, folderSortMap);
      list = ((videos ?? []) as any[]).filter(
        (v: any) => compareOrderKeys(orderKeyOf(v, folderSortMap), startKey) >= 0,
      );
    } else {
      const start = ((enrollRow as any)?.progress_start_at as string | null) ?? ((history ?? []) as any[]).reduce(
        (max: string | null, h: any) => (!max || h.created_at > max ? h.created_at : max),
        null as string | null,
      );
      list = ((videos ?? []) as any[]).filter((v: any) => (start ? v.created_at >= start : true));
    }
    if (list.length === 0) return [];

    const [{ data: progress }, { data: exclusions }] = await Promise.all([
      supabaseAdmin
        .from("video_progress")
        .select("video_id, watched_ratio, watched_seconds, seek_attempts, max_seconds, current_seconds, duration, is_completed, completed_at, updated_at")
        .eq("user_id", data.userId)
        .in("video_id", list.map((v: any) => v.id)),
      supabaseAdmin
        .from("video_student_exclusions")
        .select("video_id")
        .eq("user_id", data.userId)
        .in("video_id", list.map((v: any) => v.id))
        .is("deleted_at", null),
    ]);

    const pMap = new Map(((progress ?? []) as any[]).map((p: any) => [p.video_id, p]));
    const hiddenSet = new Set(((exclusions ?? []) as any[]).map((x: any) => x.video_id as string));
    return list.map((v: any) => {
      const p: any = pMap.get(v.id);
      const folder: any = v.folder_id ? folderById.get(v.folder_id) : null;
      return {
        video_id: v.id,
        title: v.title,
        folder_id: (v.folder_id ?? null) as string | null,
        folder_name: folderPath(v.folder_id ?? null),
        folder_sort: folder?.sort_order ?? 9999,
        folder_is_required: folder ? !!folder.is_required : null,
        is_hidden: hiddenSet.has(v.id as string),
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

// 특정 영상을 학생별로 얼마나 시청했는지 (학습현황의 역방향 조회)
export const getVideoStudentStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ classId: z.string().uuid(), videoId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertOwnClassOrAdmin(context, data.classId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: students }, { data: progress }, { data: exclusions }] = await Promise.all([
      supabaseAdmin
        .from("class_students")
        .select("user_id, created_at")
        .eq("class_id", data.classId)
        .is("deleted_at", null),
      supabaseAdmin
        .from("video_progress")
        .select("user_id, watched_ratio, watched_seconds, seek_attempts, is_completed, completed_at, updated_at")
        .eq("video_id", data.videoId),
      supabaseAdmin
        .from("video_student_exclusions")
        .select("user_id")
        .eq("video_id", data.videoId)
        .is("deleted_at", null),
    ]);

    const ids = ((students ?? []) as any[]).map((s: any) => s.user_id as string);
    if (ids.length === 0) return [];

    const { data: externals } = await supabaseAdmin
      .from("external_students")
      .select("auth_user_id, name, school, grade, branch")
      .in("auth_user_id", ids)
      .eq("is_deleted", false);

    const nameMap = new Map(
      ((externals ?? []) as any[]).map((e: any) => [e.auth_user_id as string, e]),
    );
    const pMap = new Map(((progress ?? []) as any[]).map((p: any) => [p.user_id, p]));
    const hiddenSet = new Set(((exclusions ?? []) as any[]).map((x: any) => x.user_id as string));

    const list = ids.map((uid) => {
      const e: any = nameMap.get(uid);
      const p: any = pMap.get(uid);
      return {
        user_id: uid,
        name: e?.name ?? "(이름 없음)",
        school: e?.school ?? "",
        grade: e?.grade ?? "",
        branch: e?.branch ?? "",
        is_hidden: hiddenSet.has(uid),
        watched_ratio: p ? Math.min(1, Number(p.watched_ratio ?? 0)) : 0,
        watched_seconds: Number(p?.watched_seconds ?? 0),
        seek_attempts: Number(p?.seek_attempts ?? 0),
        is_completed: !!p?.is_completed,
        completed_at: p?.completed_at ?? null,
        updated_at: p?.updated_at ?? null,
      };
    });
    // 완료 → 시청 중 → 미시청 순, 같은 상태면 이름순
    const rank = (r: any) => (r.is_completed ? 0 : r.watched_ratio > 0 ? 1 : 2);
    list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "ko"));
    return list;
  });

// 강사/관리자가 특정 학생의 영상 시청률을 임의로 수정
export const setStudentVideoProgress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        classId: z.string().uuid(),
        userId: z.string().uuid(),
        videoId: z.string().uuid(),
        ratio: z.number().min(0).max(1),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertOwnClassOrAdmin(context, data.classId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 영상이 해당 수강반 소속인지 확인
    const { data: video, error: vErr } = await supabaseAdmin
      .from("videos")
      .select("id, duration, completion_ratio, class_id")
      .eq("id", data.videoId)
      .is("deleted_at", null)
      .maybeSingle();
    if (vErr) throw new Error(vErr.message);
    if (!video || (video as any).class_id !== data.classId) {
      throw new Error("해당 수강반의 영상이 아닙니다.");
    }

    const { data: prev } = await supabaseAdmin
      .from("video_progress")
      .select("duration, seek_attempts, completed_at")
      .eq("user_id", data.userId)
      .eq("video_id", data.videoId)
      .maybeSingle();

    const duration = Number((video as any).duration ?? (prev as any)?.duration ?? 0) || 0;
    const ratio = Math.min(1, Math.max(0, data.ratio));
    const threshold = Number((video as any).completion_ratio ?? 0.9) || 0.9;
    const completed = ratio >= Math.min(1, threshold);
    const seconds = duration > 0 ? Math.round(duration * ratio) : 0;
    const nowIso = new Date().toISOString();

    const { error } = await supabaseAdmin.from("video_progress").upsert(
      {
        user_id: data.userId,
        video_id: data.videoId,
        current_seconds: seconds,
        max_seconds: seconds,
        watched_seconds: seconds,
        watched_ratio: ratio,
        duration: duration > 0 ? duration : null,
        is_completed: completed,
        completed_at: completed ? ((prev as any)?.completed_at ?? nowIso) : null,
        seek_attempts: Number((prev as any)?.seek_attempts ?? 0),
        updated_at: nowIso,
      } as any,
      { onConflict: "user_id,video_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true, ratio, is_completed: completed };
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



// 학생별 "학습 현황 시작 영상" 설정 (videoId=null이면 배정 시점 기준으로 되돌림)
export const setStudentProgressStart = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        classId: z.string().uuid(),
        userIds: z.array(z.string().uuid()).min(1).max(1000),
        videoId: z.string().uuid().nullable(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertOwnClassOrAdmin(context, data.classId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let startAt: string | null = null;
    if (data.videoId) {
      const { data: v, error } = await supabaseAdmin
        .from("videos")
        .select("created_at, class_id")
        .eq("id", data.videoId)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!v || v.class_id !== data.classId) throw new Error("이 수강반의 영상이 아닙니다.");
      startAt = v.created_at;
    }
    const { error } = await supabaseAdmin
      .from("class_students")
      .update({ progress_start_at: startAt, progress_start_video_id: data.videoId } as any)
      .eq("class_id", data.classId)
      .in("user_id", data.userIds)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    return { ok: true, count: data.userIds.length };
  });
