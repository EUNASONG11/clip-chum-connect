import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  MAX_STUDENT_SEARCH_RESULTS,
  PER_TOKEN_FETCH_LIMIT,
  parseStudentSearchTokens,
} from "@/lib/student-search";


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

function isClassActive(active_from: string | null, active_to: string | null) {
  const today = new Date().toISOString().slice(0, 10);
  if (active_from && today < active_from) return false;
  if (active_to && today > active_to) return false;
  return true;
}

async function assertOwnClassOrAdmin(
  context: { supabase: any; userId: string },
  classId: string,
  mode: "read" | "write" = "write",
) {

  const admin = await isAdmin(context);
  if (admin) return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("classes")
    .select("created_by, active_from, active_to, category_id")
    .eq("id", classId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("수강반을 찾을 수 없습니다.");
  if (data.created_by === context.userId) return;
  // 배정된 강사도 접근 허용
  const { data: assigned } = await supabaseAdmin
    .from("class_instructors")
    .select("class_id")
    .eq("class_id", classId)
    .eq("instructor_user_id", context.userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (assigned) return;
  // 카테고리에 기수가 지정된 경우, 같은 기수의 강사는 "조회만" 허용
  if (mode === "read" && (data as any).category_id) {

    const [{ data: cat }, { data: me }] = await Promise.all([
      supabaseAdmin
        .from("class_categories")
        .select("cohort")
        .eq("id", (data as any).category_id)
        .is("deleted_at", null)
        .maybeSingle(),
      supabaseAdmin
        .from("instructors")
        .select("cohort, cohorts, branch")
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
  // 배정된 학생도 접근 허용 (단, 활성 기간 내에서만)
  const { data: enrolled } = await supabaseAdmin
    .from("class_students")
    .select("class_id")
    .eq("class_id", classId)
    .eq("user_id", context.userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!enrolled) {
    throw new Error("해당 수강반에 대한 권한이 없습니다.");
  }

  if (!isClassActive((data as any).active_from, (data as any).active_to)) {
    throw new Error("수강 가능 기간이 아닙니다.");
  }
}

// 쓰기 권한 여부(관리자 / 생성자 / 배정된 강사)
async function canWriteClass(
  context: { supabase: any; userId: string },
  classId: string,
): Promise<boolean> {
  try {
    await assertOwnClassOrAdmin(context, classId, "write");
    return true;
  } catch {
    return false;
  }
}



async function assertAdminOnly(context: { supabase: any; userId: string }) {
  const admin = await isAdmin(context);
  if (!admin) throw new Error("관리자만 접근할 수 있습니다.");
}


// 생성자(created_by) 이름 붙이기
async function withCreatorNames(supabaseAdmin: any, rows: any[]) {
  const ids = Array.from(new Set(rows.map((r) => r.created_by).filter(Boolean)));
  if (ids.length === 0) return rows;
  const [{ data: instr }, { data: roles }] = await Promise.all([
    supabaseAdmin.from("instructors").select("auth_user_id, name, email").in("auth_user_id", ids),
    supabaseAdmin.from("user_roles").select("user_id, role").in("user_id", ids).is("deleted_at", null),
  ]);
  const nameMap = new Map<string, string>(
    (instr ?? []).map((r: any) => [r.auth_user_id as string, (r.name || r.email || "") as string]),
  );
  const roleMap = new Map<string, string>();
  for (const r of roles ?? []) {
    if (r.role === "admin") roleMap.set(r.user_id, "관리자");
    else if (r.role === "instructor" && !roleMap.has(r.user_id)) roleMap.set(r.user_id, "강사");
  }
  return rows.map((r) => ({
    ...r,
    created_by_name: nameMap.get(r.created_by) ?? null,
    created_by_role: roleMap.get(r.created_by) ?? null,
  }));
}

// 배정된 학생 이름 붙이기
async function withStudentNames(supabaseAdmin: any, rows: any[]) {
  const classIds = rows.map((r) => r.id).filter(Boolean);
  if (classIds.length === 0) return rows;
  const { data: members, error } = await supabaseAdmin
    .from("class_students")
    .select("class_id, user_id")
    .in("class_id", classIds)
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
  if (!members || members.length === 0) {
    return rows.map((r) => ({ ...r, student_names: [], student_count: 0 }));
  }
  const userIds = Array.from(new Set(members.map((m: any) => m.user_id)));
  const { data: ext } = await supabaseAdmin
    .from("external_students")
    .select("auth_user_id, name")
    .in("auth_user_id", userIds);
  const extMap = new Map<string, string>((ext ?? []).map((e: any) => [e.auth_user_id as string, (e.name ?? "") as string]));
  const byClass = new Map<string, string[]>();
  for (const m of members as any[]) {
    const name = extMap.get(m.user_id)?.trim() || "이름 없음";
    if (!byClass.has(m.class_id)) byClass.set(m.class_id, []);
    byClass.get(m.class_id)!.push(name);
  }
  return rows.map((r) => ({
    ...r,
    student_names: byClass.get(r.id) ?? [],
    student_count: byClass.get(r.id)?.length ?? 0,
  }));
}

// 수강반 목록 (관리자: 전체, 강사: 본인 생성 + 배정된 반)
export const listClasses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await isAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (admin) {
      const { data, error } = await supabaseAdmin
        .from("classes")
        .select("id, name, description, thumbnail_url, active_from, active_to, category_id, branch, created_at, created_by")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      const withCreators = await withCreatorNames(supabaseAdmin, data ?? []);
      return await withStudentNames(supabaseAdmin, withCreators);
    }
    // 강사: 본인이 만든 것 + 배정된 것 + 본인 기수로 지정된 카테고리의 반 전체
    const [{ data: assigned }, { data: enrolled }, { data: me }] = await Promise.all([
      supabaseAdmin
        .from("class_instructors")
        .select("class_id")
        .eq("instructor_user_id", context.userId)
        .is("deleted_at", null),
      supabaseAdmin
        .from("class_students")
        .select("class_id")
        .eq("user_id", context.userId)
        .is("deleted_at", null),
      supabaseAdmin
        .from("instructors")
        .select("cohort, cohorts, branch, all_branches")
        .eq("auth_user_id", context.userId)
        .maybeSingle(),
    ]);
    const idSet = new Set<string>([
      ...(assigned ?? []).map((r: any) => r.class_id as string),
      ...(enrolled ?? []).map((r: any) => r.class_id as string),
    ]);
    const ids = Array.from(idSet);
    const orParts = [`created_by.eq.${context.userId}`];
    if (ids.length) orParts.push(`id.in.(${ids.join(",")})`);
    const myCohorts: string[] = Array.from(
      new Set([
        ...(((me as any)?.cohorts ?? []) as string[]),
        ...((me as any)?.cohort ? [(me as any).cohort as string] : []),
      ]),
    );
    if (myCohorts.length) {
      const { data: cats } = await supabaseAdmin
        .from("class_categories")
        .select("id")
        .in("cohort" as any, myCohorts)
        .is("deleted_at", null);
      const catIds = (cats ?? []).map((c: any) => c.id as string);
      if (catIds.length) orParts.push(`category_id.in.(${catIds.join(",")})`);
    }
    const { data, error } = await supabaseAdmin
      .from("classes")
      .select("id, name, description, thumbnail_url, active_from, active_to, category_id, branch, created_at, created_by")
      .or(orParts.join(","))
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    // 교육원 전용 수강반은 본인 교육원(또는 본인이 만든/배정된 반)만 노출
    const myBranch = ((me as any)?.branch ?? "").toString().trim();
    const allBranches = (me as any)?.all_branches === true;
    const visible = (data ?? []).filter((c: any) => {
      const b = (c.branch ?? "").toString().trim();
      if (!b) return true; // 모든 교육원 공개
      if (allBranches) return true; // 전체 교육원 조회 허용 강사
      if (c.created_by === context.userId || idSet.has(c.id)) return true;
      return !!myBranch && b === myBranch;
    });
    // 활성 기간이 지난 수강반도 목록에는 노출 (상세 접근은 assert에서 차단)
    const withCreators = await withCreatorNames(supabaseAdmin, visible);
    return await withStudentNames(supabaseAdmin, withCreators);
  });





// 단일 수강반 조회
export const getClass = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertOwnClassOrAdmin(context, data.id, "read");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("classes")
      .select("id, name, description, thumbnail_url, active_from, active_to, category_id, branch, created_at, created_by")
      .eq("id", data.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return row;
    const can_write = await canWriteClass(context, data.id);
    return { ...(row as any), can_write } as any;

  });


// 수강반 생성
export const createClass = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        name: z.string().min(1).max(100),
        description: z.string().max(2000).optional().nullable(),
        active_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        active_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        category_id: z.string().uuid().nullable().optional(),
        branch: z.string().trim().max(100).nullable().optional(),
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
        active_from: data.active_from ?? null,
        active_to: data.active_to ?? null,
        category_id: data.category_id ?? null,
        branch: data.branch ?? null,
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
        active_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        active_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        category_id: z.string().uuid().nullable().optional(),
        branch: z.string().trim().max(100).nullable().optional(),
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
    if (data.active_from !== undefined) patch.active_from = data.active_from;
    if (data.active_to !== undefined) patch.active_to = data.active_to;
    if (data.category_id !== undefined) patch.category_id = data.category_id;
    if (data.branch !== undefined) patch.branch = (data.branch || null);

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
    const { error } = await supabaseAdmin.from("classes").update({ deleted_at: new Date().toISOString(), deleted_by: context.userId }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// 수강반의 학생 목록 (관리자)
export const listClassStudents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ classId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertOwnClassOrAdmin(context, data.classId, "read");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("class_students")
      .select("user_id, created_at")
      .eq("class_id", data.classId)
      .is("deleted_at", null);

    if (error) throw new Error(error.message);
    if (!rows || rows.length === 0) return [];
    const userIds = rows.map((r: any) => r.user_id);
    const { data: users } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
    const emailMap = new Map(users.users.map((u) => [u.id, u.email ?? ""]));
    const { data: ext } = await supabaseAdmin
      .from("external_students")
      .select("auth_user_id, name, phone, parent_phone, branch")
      .in("auth_user_id", userIds);
    const extMap = new Map((ext ?? []).map((e: any) => [e.auth_user_id, e]));
    return rows.map((r: any) => {
      const e: any = extMap.get(r.user_id);
      return {
        user_id: r.user_id as string,
        email: emailMap.get(r.user_id) ?? "",
        name: e?.name ?? "",
        phone: e?.phone ?? "",
        parent_phone: e?.parent_phone ?? "",
        branch: e?.branch ?? "",
        created_at: r.created_at as string,
      };
    });
  });


// 이름 또는 전화번호로 학생 검색 (미러링된 external_students에서 조회)
// 검색 규칙/제한은 @/lib/student-search 참조


export const searchStudentsByNameOrPhone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        query: z.string().min(1).max(100),
        branch: z.string().trim().min(1).max(100).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdminOrInstructor(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const tokens = parseStudentSearchTokens(data.query);
    if (tokens.length === 0) return [];

    const byId = new Map<string, any>();
    for (const token of tokens) {
      if (byId.size >= MAX_STUDENT_SEARCH_RESULTS) break;
      let builder = supabaseAdmin
        .from("external_students")
        .select("auth_user_id, name, phone, parent_phone, school, grade, branch")
        .not("auth_user_id", "is", null)
        .eq("is_deleted", false)
        .order("name")
        .limit(PER_TOKEN_FETCH_LIMIT);
      if (data.branch) builder = builder.eq("branch", data.branch);
      if (token.kind === "phone") {
        builder = builder.or(`phone.ilike.%${token.value}%,parent_phone.ilike.%${token.value}%`);
      } else {
        builder = builder.ilike("name", `%${token.value}%`);
      }
      const { data: rows, error } = await builder;
      if (error) throw new Error(error.message);
      for (const r of rows ?? []) {
        if (!byId.has(r.auth_user_id)) byId.set(r.auth_user_id, r);
      }
    }

    // 승인 완료(student 역할)된 계정만 노출
    const candidateIds = Array.from(byId.keys());
    if (candidateIds.length === 0) return [];
    const { data: roleRows, error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "student")
      .is("deleted_at", null)
      .in("user_id", candidateIds);
    if (roleErr) throw new Error(roleErr.message);
    const approved = new Set((roleRows ?? []).map((r: any) => r.user_id as string));

    return candidateIds
      .filter((id) => approved.has(id))
      .slice(0, MAX_STUDENT_SEARCH_RESULTS)
      .map((id) => {
        const r = byId.get(id);
        return {
          user_id: id,
          name: r.name as string,
          phone: (r.phone as string) ?? "",
          parent_phone: (r.parent_phone as string) ?? "",
          school: (r.school as string) ?? "",
          grade: (r.grade as string) ?? "",
          branch: (r.branch as string) ?? "",
        };
      });
  });


// 교육원(branch) 목록 조회 - 학생 배정 필터 등에 사용
export const listStudentBranches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminOrInstructor(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("external_students")
      .select("branch")
      .not("branch", "is", null)
      .eq("is_deleted", false);
    if (error) throw new Error(error.message);
    const set = new Set<string>();
    (data ?? []).forEach((r: any) => {
      const b = (r.branch ?? "").toString().trim();
      if (b) set.add(b);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ko"));
  });

// 배정 이력의 처리자(actor) 보정: service_role 쓰기에서는 auth.uid()가 없으므로 직접 기록
async function stampEnrollmentActor(
  supabaseAdmin: any,
  classId: string,
  userId: string,
  action: "added" | "removed",
  actorId: string,
) {
  const { data: rows } = await supabaseAdmin
    .from("class_enrollment_history")
    .select("id")
    .eq("class_id", classId)
    .eq("user_id", userId)
    .eq("action", action)
    .is("actor_id", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const rowId = rows?.[0]?.id;
  if (rowId) {
    await supabaseAdmin
      .from("class_enrollment_history")
      .update({ actor_id: actorId })
      .eq("id", rowId);
  }
}

// 학생 배정 (user_id 기반)
export const assignStudent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ classId: z.string().uuid(), userId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertOwnClassOrAdmin(context, data.classId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // 소프트 삭제된 기존 배정이 있으면 복원, 없으면 신규 삽입
    const { error } = await supabaseAdmin
      .from("class_students")
      .upsert(
        { class_id: data.classId, user_id: data.userId, deleted_at: null, deleted_by: null },
        { onConflict: "class_id,user_id" },
      );
    if (error) throw new Error(error.message);
    await stampEnrollmentActor(supabaseAdmin, data.classId, data.userId, "added", context.userId);
    return { ok: true };
  });



// 학생 배정 해제
export const unassignStudent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ classId: z.string().uuid(), userId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertOwnClassOrAdmin(context, data.classId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("class_students")
      .update({ deleted_at: new Date().toISOString(), deleted_by: context.userId })
      .eq("class_id", data.classId)
      .eq("user_id", data.userId)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    await stampEnrollmentActor(supabaseAdmin, data.classId, data.userId, "removed", context.userId);
    return { ok: true };
  });



// 수강반 배정 이력 조회 (추가/해제 히스토리) - 서버 페이지네이션/검색
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

export const listClassEnrollmentHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        classId: z.string().uuid(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(5).max(100).default(20),
        search: z.string().max(200).optional().default(""),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertOwnClassOrAdmin(context, data.classId, "read");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const q = (data.search ?? "").trim();
    let query = supabaseAdmin
      .from("class_enrollment_history")
      .select("id, user_id, action, actor_id, created_at", { count: "exact" })
      .eq("class_id", data.classId);

    if (q) {
      const like = `%${q}%`;
      const [{ data: extMatch }, { data: instrMatch }] = await Promise.all([
        supabaseAdmin
          .from("external_students")
          .select("auth_user_id")
          .not("auth_user_id", "is", null)
          .or(`name.ilike.${like},phone.ilike.${like},parent_phone.ilike.${like}`)
          .limit(500),
        supabaseAdmin
          .from("instructors")
          .select("auth_user_id")
          .not("auth_user_id", "is", null)
          .ilike("name", like)
          .limit(500),
      ]);
      const studentIds = (extMatch ?? []).map((e: any) => e.auth_user_id as string);
      const actorIds2 = (instrMatch ?? []).map((e: any) => e.auth_user_id as string);
      const ors = [
        `user_id.in.(${(studentIds.length ? studentIds : [NIL_UUID]).join(",")})`,
        `actor_id.in.(${(actorIds2.length ? actorIds2 : [NIL_UUID]).join(",")})`,
      ];
      if ("배정".includes(q) || q.toLowerCase() === "added") ors.push("action.eq.added");
      if ("해제".includes(q) || q.toLowerCase() === "removed") ors.push("action.eq.removed");
      query = query.or(ors.join(","));
    }

    const from = (data.page - 1) * data.pageSize;
    const { data: rows, count, error } = await query
      .order("created_at", { ascending: false })
      .range(from, from + data.pageSize - 1);
    if (error) throw new Error(error.message);
    const total = count ?? 0;
    if (!rows || rows.length === 0) return { rows: [], total };

    const userIds = Array.from(new Set(rows.map((r: any) => r.user_id)));
    const actorIds = Array.from(
      new Set(rows.map((r: any) => r.actor_id).filter(Boolean)),
    ) as string[];
    const { data: ext } = await supabaseAdmin
      .from("external_students")
      .select("auth_user_id, name, phone, parent_phone, branch")
      .in("auth_user_id", userIds);
    const extMap = new Map((ext ?? []).map((e: any) => [e.auth_user_id, e]));
    const idsForEmail = Array.from(new Set([...userIds, ...actorIds])) as string[];
    const emailPairs = await Promise.all(
      idsForEmail.map(async (uid) => {
        const { data: u } = await supabaseAdmin.auth.admin.getUserById(uid);
        return [uid, u?.user?.email ?? ""] as [string, string];
      }),
    );
    const emailMap = new Map(emailPairs);

    const actorMap = new Map<string, string>();
    const actorRoleMap = new Map<string, "admin" | "instructor" | "other">();
    if (actorIds.length > 0) {
      const [{ data: instr }, { data: roles }] = await Promise.all([
        supabaseAdmin
          .from("instructors")
          .select("auth_user_id, name")
          .in("auth_user_id", actorIds),
        supabaseAdmin
          .from("user_roles")
          .select("user_id, role")
          .in("user_id", actorIds)
          .is("deleted_at", null),
      ]);
      for (const i of instr ?? []) {
        if ((i as any).auth_user_id) actorMap.set((i as any).auth_user_id, (i as any).name ?? "");
      }
      for (const id of actorIds) {
        if (!actorMap.has(id) || !actorMap.get(id)) actorMap.set(id, emailMap.get(id) ?? "");
      }
      for (const r of roles ?? []) {
        const uid = (r as any).user_id as string;
        const role = (r as any).role as string;
        if (role === "admin") actorRoleMap.set(uid, "admin");
        else if (role === "instructor" && actorRoleMap.get(uid) !== "admin")
          actorRoleMap.set(uid, "instructor");
        else if (!actorRoleMap.has(uid)) actorRoleMap.set(uid, "other");
      }
    }
    const mapped = rows.map((r: any) => {
      const e: any = extMap.get(r.user_id);
      return {
        id: r.id as string,
        user_id: r.user_id as string,
        action: r.action as "added" | "removed",
        actor_id: r.actor_id as string | null,
        actor_name: r.actor_id ? actorMap.get(r.actor_id) ?? "" : "",
        actor_role: r.actor_id ? actorRoleMap.get(r.actor_id) ?? "other" : null,
        student_name: e?.name ?? "",
        student_phone: e?.phone ?? "",
        student_parent_phone: e?.parent_phone ?? "",
        student_branch: e?.branch ?? null,
        student_email: emailMap.get(r.user_id) ?? "",
        created_at: r.created_at as string,
      };
    });
    return { rows: mapped, total };
  });


// 수강반의 영상 목록 (관리자: 전체, 강사: 본인 수강반)
export const listClassVideos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ classId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertOwnClassOrAdmin(context, data.classId, "read");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("videos")
      .select("id, title, description, thumbnail_url, duration, status, is_published, sort_order, folder_id, created_at")
      .eq("class_id", data.classId)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const videos = rows ?? [];
    const videoIds = videos.map((r: any) => r.id);
    const progressMap = new Map<string, any>();
    if (videoIds.length > 0) {
      const { data: progress, error: pErr } = await supabaseAdmin
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
        folder_id: z.string().uuid().nullable().optional(),
        is_published: z.boolean().optional(),
        sort_order: z.number().int().optional(),
        completion_ratio: z.number().min(0).max(1).optional(),
        allow_seek: z.boolean().optional(),
        max_playback_rate: z.number().min(0.5).max(4).optional(),
        rewatch_allow_seek: z.boolean().nullable().optional(),
        rewatch_max_playback_rate: z.number().min(0.5).max(4).nullable().optional(),
        thumbnail_url: z.string().max(1000).nullable().optional(),
        week_label: z.string().regex(/^\d{4}-\d{2}-[1-5]$/).nullable().optional(),

      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const admin = await isAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (!admin) {
      // 강사: 영상이 속한 수강반의 담당(생성자 또는 배정 강사)만 수정 가능
      const { data: v, error: ve } = await supabaseAdmin
        .from("videos")
        .select("class_id")
        .eq("id", data.id)
        .is("deleted_at", null)
        .maybeSingle();
      if (ve) throw new Error(ve.message);
      if (!v) throw new Error("영상을 찾을 수 없습니다.");
      const check = async (cid: string | null | undefined) => {
        if (!cid) throw new Error("해당 영상에 대한 권한이 없습니다.");
        const { data: cls } = await supabaseAdmin
          .from("classes").select("created_by").eq("id", cid).is("deleted_at", null).maybeSingle();
        if (cls?.created_by === context.userId) return;
        const { data: assigned } = await supabaseAdmin
          .from("class_instructors").select("class_id")
          .eq("class_id", cid).eq("instructor_user_id", context.userId).is("deleted_at", null).maybeSingle();
        if (!assigned) throw new Error("해당 영상에 대한 권한이 없습니다.");
      };
      await check(v.class_id);

      // 다른 수강반으로 옮기려면 대상 수강반에도 권한 필요
      if (data.class_id !== undefined && data.class_id !== v.class_id) {
        await check(data.class_id);
      }
    }
    const patch: Record<string, unknown> = {};
    for (const k of ["title", "description", "class_id", "folder_id", "is_published", "sort_order", "completion_ratio", "allow_seek", "max_playback_rate", "rewatch_allow_seek", "rewatch_max_playback_rate", "thumbnail_url", "week_label"] as const) {
      if (data[k] !== undefined) patch[k] = data[k];
    }

    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await supabaseAdmin.from("videos").update(patch as any).eq("id", data.id);
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
    await assertOwnClassOrAdmin(context, data.classId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: list, error } = await supabaseAdmin
      .from("videos")
      .select("id, sort_order")
      .eq("class_id", data.classId)
      .is("deleted_at", null)
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


// ============================================================
// 강사 배정 (관리자 전용)
// ============================================================

// 수강반에 배정된 강사 목록
export const listClassInstructors = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ classId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertOwnClassOrAdmin(context, data.classId, "read");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("class_instructors")
      .select("instructor_user_id, created_at")
      .eq("class_id", data.classId)
      .is("deleted_at", null);

    if (error) throw new Error(error.message);
    const ids = (rows ?? []).map((r: any) => r.instructor_user_id);
    if (ids.length === 0) return [];
    const { data: instr } = await supabaseAdmin
      .from("instructors")
      .select("auth_user_id, name, email")
      .in("auth_user_id", ids);
    const map = new Map((instr ?? []).map((r: any) => [r.auth_user_id, r]));
    return (rows ?? []).map((r: any) => {
      const m: any = map.get(r.instructor_user_id) ?? {};
      return {
        user_id: r.instructor_user_id as string,
        name: (m.name as string) ?? "",
        email: (m.email as string) ?? "",
        created_at: r.created_at as string,
      };
    });
  });

// 이름/이메일로 강사 검색 (auth 계정이 있는 강사만)
export const searchInstructors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ query: z.string().min(1).max(100) }).parse(i))
  .handler(async ({ context, data }) => {
    await assertAdminOrInstructor(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const q = data.query.trim();
    const { data: rows, error } = await supabaseAdmin
      .from("instructors")
      .select("auth_user_id, name, email")
      .not("auth_user_id", "is", null)
      .or(`name.ilike.%${q}%,email.ilike.%${q}%`)
      .limit(20);
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => ({
      user_id: r.auth_user_id as string,
      name: (r.name as string) ?? "",
      email: (r.email as string) ?? "",
    }));
  });

// 강사 배정
export const assignInstructor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ classId: z.string().uuid(), userId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ context, data }) => {
    await assertAdminOrInstructor(context);
    await assertOwnClassOrAdmin(context, data.classId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("class_instructors")
      .upsert(
        { class_id: data.classId, instructor_user_id: data.userId, deleted_at: null, deleted_by: null },
        { onConflict: "class_id,instructor_user_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// 강사 배정 해제
export const unassignInstructor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ classId: z.string().uuid(), userId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ context, data }) => {
    await assertAdminOrInstructor(context);
    await assertOwnClassOrAdmin(context, data.classId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("class_instructors")
      .update({ deleted_at: new Date().toISOString(), deleted_by: context.userId })
      .eq("class_id", data.classId)
      .eq("instructor_user_id", data.userId)
      .is("deleted_at", null);

    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ================= 폴더 관리 =================

// 폴더 목록 (관리자/강사/학생 - 각 접근 권한에 따라)
export const listClassFolders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ classId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertOwnClassOrAdmin(context, data.classId, "read");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("class_folders")
      .select("id, name, sort_order, parent_folder_id, created_at")
      .eq("class_id", data.classId)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// 폴더 생성 (관리자/담당 강사)
export const createClassFolder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      classId: z.string().uuid(),
      name: z.string().min(1).max(100),
      parentFolderId: z.string().uuid().nullable().optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdminOrInstructor(context);
    await assertOwnClassOrAdmin(context, data.classId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // 부모 폴더가 같은 수강반 소속인지 검증
    if (data.parentFolderId) {
      const { data: parent } = await supabaseAdmin
        .from("class_folders")
        .select("class_id")
        .eq("id", data.parentFolderId)
        .is("deleted_at", null)
        .maybeSingle();
      if (!parent || (parent as any).class_id !== data.classId) {
        throw new Error("잘못된 상위 폴더입니다.");
      }
    }
    // 다음 sort_order 계산 (같은 부모 내에서)
    let sortBuilder = supabaseAdmin
      .from("class_folders")
      .select("sort_order")
      .eq("class_id", data.classId)
      .is("deleted_at", null)
      .order("sort_order", { ascending: false })
      .limit(1);
    sortBuilder = data.parentFolderId
      ? sortBuilder.eq("parent_folder_id", data.parentFolderId)
      : sortBuilder.is("parent_folder_id", null);
    const { data: existing } = await sortBuilder;

    const nextOrder = existing && existing.length > 0 ? (existing[0] as any).sort_order + 1 : 0;
    const { data: inserted, error } = await supabaseAdmin
      .from("class_folders")
      .insert({
        class_id: data.classId,
        name: data.name,
        sort_order: nextOrder,
        parent_folder_id: data.parentFolderId ?? null,
        created_by: context.userId,
      })
      .select("id, name, sort_order, parent_folder_id")
      .single();
    if (error) throw new Error(error.message);
    return inserted;
  });

// 폴더 수정 (이름 변경)
export const updateClassFolder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      id: z.string().uuid(),
      name: z.string().min(1).max(100),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdminOrInstructor(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: f, error: fe } = await supabaseAdmin
      .from("class_folders")
      .select("class_id")
      .eq("id", data.id)
      .is("deleted_at", null)
      .maybeSingle();

    if (fe) throw new Error(fe.message);
    if (!f) throw new Error("폴더를 찾을 수 없습니다.");
    await assertOwnClassOrAdmin(context, (f as any).class_id);
    const { error } = await supabaseAdmin
      .from("class_folders")
      .update({ name: data.name })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// 폴더 삭제 (해당 폴더의 영상들은 폴더 미지정 상태로 남음)
export const deleteClassFolder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdminOrInstructor(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: f, error: fe } = await supabaseAdmin
      .from("class_folders")
      .select("class_id")
      .eq("id", data.id)
      .is("deleted_at", null)
      .maybeSingle();

    if (fe) throw new Error(fe.message);
    if (!f) throw new Error("폴더를 찾을 수 없습니다.");
    await assertOwnClassOrAdmin(context, (f as any).class_id);
    const { error } = await supabaseAdmin
      .from("class_folders")
      .update({ deleted_at: new Date().toISOString(), deleted_by: context.userId })
      .eq("id", data.id);

    if (error) throw new Error(error.message);
    return { ok: true };
  });

// 영상의 폴더 지정 변경
export const setVideoFolder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      videoId: z.string().uuid(),
      folderId: z.string().uuid().nullable(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdminOrInstructor(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: v, error: ve } = await supabaseAdmin
      .from("videos")
      .select("class_id")
      .eq("id", data.videoId)
      .is("deleted_at", null)
      .maybeSingle();
    if (ve) throw new Error(ve.message);
    if (!v || !(v as any).class_id) throw new Error("영상을 찾을 수 없습니다.");
    await assertOwnClassOrAdmin(context, (v as any).class_id);
    if (data.folderId) {
      const { data: f } = await supabaseAdmin
        .from("class_folders")
        .select("class_id")
        .eq("id", data.folderId)
        .is("deleted_at", null)
        .maybeSingle();
      if (!f || (f as any).class_id !== (v as any).class_id) {
        throw new Error("잘못된 폴더입니다.");
      }
    }

    const { error } = await supabaseAdmin
      .from("videos")
      .update({ folder_id: data.folderId })
      .eq("id", data.videoId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });


// ================= 카테고리 관리 =================

// 카테고리 목록 (로그인 사용자 전체)
export const listClassCategories = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("class_categories")
      .select("id, name, color, sort_order, cohort, created_at")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// 카테고리별 수강반 개수 (권한 무관, 개수만 노출)
export const getCategoryClassCounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("classes")
      .select("category_id")
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    const counts: Record<string, number> = {};
    (data ?? []).forEach((r: any) => {
      if (!r.category_id) return;
      counts[r.category_id] = (counts[r.category_id] ?? 0) + 1;
    });
    return counts;
  });



// 카테고리 생성 (관리자/강사)
export const createClassCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      name: z.string().min(1).max(100),
      color: z.string().max(20).nullable().optional(),
      cohort: z.string().max(20).nullable().optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdminOrInstructor(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existing } = await supabaseAdmin
      .from("class_categories")
      .select("sort_order")
      .is("deleted_at", null)
      .order("sort_order", { ascending: false })
      .limit(1);

    const nextOrder = existing && existing.length > 0 ? (existing[0] as any).sort_order + 1 : 0;
    const { data: row, error } = await supabaseAdmin
      .from("class_categories")
      .insert({
        name: data.name,
        color: data.color ?? null,
        cohort: data.cohort ?? null,
        sort_order: nextOrder,
        created_by: context.userId,
      })
      .select("id, name, color, sort_order, cohort")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

// 카테고리 수정
export const updateClassCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      id: z.string().uuid(),
      name: z.string().min(1).max(100).optional(),
      color: z.string().max(20).nullable().optional(),
      cohort: z.string().max(20).nullable().optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdminOrInstructor(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.color !== undefined) patch.color = data.color;
    if (data.cohort !== undefined) patch.cohort = data.cohort;
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await supabaseAdmin
      .from("class_categories")
      .update(patch as any)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// 카테고리 삭제 (해당 카테고리의 수강반은 category_id가 NULL로 변경)
export const deleteClassCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdminOrInstructor(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("class_categories")
      .update({ deleted_at: new Date().toISOString(), deleted_by: context.userId })
      .eq("id", data.id);

    if (error) throw new Error(error.message);
    return { ok: true };
  });
