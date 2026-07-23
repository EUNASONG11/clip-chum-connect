import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function isAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  return !!data;
}

async function isInstructor(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "instructor",
  });
  if (error) throw new Error(error.message);
  return !!data;
}

async function assertAdminOrInstructor(context: { supabase: any; userId: string }) {
  const [admin, instructor] = await Promise.all([isAdmin(context), isInstructor(context)]);
  if (!admin && !instructor) throw new Error("관리자 또는 강사만 접근할 수 있습니다.");
}

async function assertOwnClassOrAdmin(
  context: { supabase: any; userId: string },
  classId: string,
) {
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

async function assertAdminOnly(context: { supabase: any; userId: string }) {
  const admin = await isAdmin(context);
  if (!admin) throw new Error("관리자만 접근할 수 있습니다.");
}

// 수강반 목록 (관리자: 전체, 강사: 본인이 생성한 반)
export const listClasses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await isAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let builder = supabaseAdmin
      .from("classes")
      .select("id, name, description, thumbnail_url, created_at, created_by")
      .order("created_at", { ascending: false });
    if (!admin) builder = builder.eq("created_by", context.userId);
    const { data, error } = await builder;
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// 단일 수강반 조회
export const getClass = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertOwnClassOrAdmin(context, data.id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("classes")
      .select("id, name, description, thumbnail_url, created_at, created_by")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row;
  });

// 수강반 생성
export const createClass = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        name: z.string().min(1).max(100),
        description: z.string().max(2000).optional().nullable(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdminOrInstructor(context);
    const { data: row, error } = await context.supabase
      .from("classes")
      .insert({
        name: data.name,
        description: data.description ?? null,
        created_by: context.userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

// 수강반 수정
export const updateClass = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(2000).optional().nullable(),
        thumbnail_url: z.string().max(1000).nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertOwnClassOrAdmin(context, data.id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.description !== undefined) patch.description = data.description ?? null;
    if (data.thumbnail_url !== undefined) patch.thumbnail_url = data.thumbnail_url;
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await supabaseAdmin
      .from("classes")
      .update(patch as any)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// 수강반 삭제
export const deleteClass = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertOwnClassOrAdmin(context, data.id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("classes").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// 수강반의 학생 목록 (관리자)
export const listClassStudents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ classId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertOwnClassOrAdmin(context, data.classId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("class_students")
      .select("user_id, created_at")
      .eq("class_id", data.classId);
    if (error) throw new Error(error.message);
    if (!rows || rows.length === 0) return [];
    const userIds = rows.map((r: any) => r.user_id);
    const { data: users } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
    const emailMap = new Map(users.users.map((u) => [u.id, u.email ?? ""]));
    const { data: ext } = await supabaseAdmin
      .from("external_students")
      .select("auth_user_id, name, phone")
      .in("auth_user_id", userIds);
    const extMap = new Map((ext ?? []).map((e: any) => [e.auth_user_id, e]));
    return rows.map((r: any) => {
      const e: any = extMap.get(r.user_id);
      return {
        user_id: r.user_id as string,
        email: emailMap.get(r.user_id) ?? "",
        name: e?.name ?? "",
        phone: e?.phone ?? "",
        created_at: r.created_at as string,
      };
    });
  });


// 이름 또는 전화번호로 학생 검색 (미러링된 external_students에서 조회)
export const searchStudentsByNameOrPhone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ query: z.string().min(1).max(100) }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const q = data.query.trim();
    const digits = q.replace(/[^0-9]/g, "");
    let builder = supabaseAdmin
      .from("external_students")
      .select("auth_user_id, name, phone, school, grade")
      .not("auth_user_id", "is", null)
      .eq("is_deleted", false)
      .limit(20);
    if (digits.length >= 2 && digits.length === q.replace(/[-\s]/g, "").length) {
      builder = builder.ilike("phone", `%${digits}%`);
    } else {
      builder = builder.ilike("name", `%${q}%`);
    }
    const { data: rows, error } = await builder;
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => ({
      user_id: r.auth_user_id as string,
      name: r.name as string,
      phone: (r.phone as string) ?? "",
      school: (r.school as string) ?? "",
      grade: (r.grade as string) ?? "",
    }));
  });

// 학생 배정 (user_id 기반)
export const assignStudent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ classId: z.string().uuid(), userId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("class_students")
      .insert({ class_id: data.classId, user_id: data.userId });
    if (error && !error.message.includes("duplicate")) throw new Error(error.message);
    return { ok: true };
  });


// 학생 배정 해제
export const unassignStudent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ classId: z.string().uuid(), userId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("class_students")
      .delete()
      .eq("class_id", data.classId)
      .eq("user_id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// 수강반의 영상 목록 (RLS로 관리자/학생 자동 처리)
export const listClassVideos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ classId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("videos")
      .select("id, title, description, thumbnail_url, duration, status, is_published, sort_order, created_at")
      .eq("class_id", data.classId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const videos = rows ?? [];
    const videoIds = videos.map((r: any) => r.id);
    const progressMap = new Map<string, any>();
    if (videoIds.length > 0) {
      const { data: progress, error: pErr } = await context.supabase
        .from("video_progress")
        .select("video_id, current_seconds, watched_ratio, is_completed")
        .eq("user_id", context.userId)
        .in("video_id", videoIds);
      if (pErr) throw new Error(pErr.message);
      for (const p of progress ?? []) {
        progressMap.set(p.video_id as string, p);
      }
    }
    return videos.map((r: any) => ({
      ...r,
      progress: progressMap.get(r.id as string) ?? null,
    }));
  });

// 영상 수정 (관리자)
export const updateVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        id: z.string().uuid(),
        title: z.string().min(1).max(200).optional(),
        description: z.string().max(5000).optional().nullable(),
        class_id: z.string().uuid().nullable().optional(),
        is_published: z.boolean().optional(),
        sort_order: z.number().int().optional(),
        completion_ratio: z.number().min(0).max(1).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const patch: Record<string, unknown> = {};
    for (const k of ["title", "description", "class_id", "is_published", "sort_order", "completion_ratio"] as const) {
      if (data[k] !== undefined) patch[k] = data[k];
    }
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await context.supabase.from("videos").update(patch as any).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// 차시 순서 재정렬 (인접 항목과 교환)
export const swapVideoOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      classId: z.string().uuid(),
      videoId: z.string().uuid(),
      direction: z.enum(["up", "down"]),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: list, error } = await context.supabase
      .from("videos")
      .select("id, sort_order")
      .eq("class_id", data.classId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const rows = (list ?? []) as { id: string; sort_order: number | null }[];
    // 정규화된 순서 확보
    const normalized = rows.map((r, i) => ({ ...r, sort_order: i }));
    const idx = normalized.findIndex((r) => r.id === data.videoId);
    if (idx < 0) return { ok: true };
    const swapWith = data.direction === "up" ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= normalized.length) return { ok: true };
    const a = normalized[idx];
    const b = normalized[swapWith];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // 우선 전체 정규화 저장 (기존 값이 NULL/중복이어도 안전하게)
    for (const r of normalized) {
      if (r.id === a.id || r.id === b.id) continue;
      await supabaseAdmin.from("videos").update({ sort_order: r.sort_order }).eq("id", r.id);
    }
    await supabaseAdmin.from("videos").update({ sort_order: b.sort_order }).eq("id", a.id);
    await supabaseAdmin.from("videos").update({ sort_order: a.sort_order }).eq("id", b.id);
    return { ok: true };
  });

// 내 최근 학습(진도) 요약 — 마이페이지용
export const listMyRecentProgress = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("video_progress")
      .select("video_id, current_seconds, watched_ratio, is_completed, updated_at, videos(id, title, thumbnail_url, class_id, duration)")
      .eq("user_id", context.userId)
      .order("updated_at", { ascending: false })
      .limit(10);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

