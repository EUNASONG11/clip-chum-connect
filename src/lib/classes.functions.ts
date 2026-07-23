import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("관리자만 접근할 수 있습니다.");
}

// 수강반 목록 (관리자: 전체, 학생: 배정된 반 — RLS로 처리)
export const listClasses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("classes")
      .select("id, name, description, thumbnail_url, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// 단일 수강반 조회
export const getClass = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("classes")
      .select("id, name, description, thumbnail_url, created_at")
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
    await assertAdmin(context);
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
        name: z.string().min(1).max(100),
        description: z.string().max(2000).optional().nullable(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase
      .from("classes")
      .update({ name: data.name, description: data.description ?? null })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// 수강반 삭제
export const deleteClass = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase.from("classes").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// 수강반의 학생 목록 (관리자)
export const listClassStudents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ classId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
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
    return rows ?? [];
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
