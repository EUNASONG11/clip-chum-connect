import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  MAX_STUDENT_SEARCH_RESULTS,
  PER_TOKEN_FETCH_LIMIT,
  parseStudentSearchTokens,
} from "@/lib/student-search";


async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("관리자만 접근할 수 있습니다.");
}

// 팀 목록 (관리자: 전체 / 학생: 본인 소속만)
export const listTeams = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: isAdminData } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    const isAdmin = !!isAdminData;

    let teamIds: string[] | null = null;
    if (!isAdmin) {
      const { data: myMem } = await supabaseAdmin
        .from("team_members")
        .select("team_id")
        .eq("user_id", context.userId)
        .is("deleted_at", null);
      teamIds = (myMem ?? []).map((r: any) => r.team_id);
      if (teamIds.length === 0) return [];
    }

    let q = supabaseAdmin
      .from("teams")
      .select("id, name, description, created_by, created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (teamIds) q = q.in("id", teamIds);
    const { data: teams, error } = await q;
    if (error) throw new Error(error.message);

    // 멤버 수 집계
    const ids = (teams ?? []).map((t: any) => t.id);
    const counts = new Map<string, number>();
    if (ids.length > 0) {
      const { data: mems } = await supabaseAdmin
        .from("team_members")
        .select("team_id")
        .in("team_id", ids)
        .is("deleted_at", null);
      (mems ?? []).forEach((m: any) => {
        counts.set(m.team_id, (counts.get(m.team_id) ?? 0) + 1);
      });
    }

    return (teams ?? []).map((t: any) => ({
      ...t,
      member_count: counts.get(t.id) ?? 0,
    }));
  });

export const createTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ name: z.string().min(1).max(100), description: z.string().max(500).optional() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("teams")
      .insert({ name: data.name, description: data.description ?? null, created_by: context.userId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id as string };
  });

export const updateTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(500).nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: { name?: string; description?: string | null } = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.description !== undefined) patch.description = data.description;
    const { error } = await supabaseAdmin.from("teams").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("teams").update({ deleted_at: new Date().toISOString(), deleted_by: context.userId }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });


// 팀 상세 (멤버 포함)
export const getTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: team, error } = await supabaseAdmin
      .from("teams")
      .select("id, name, description, created_at")
      .eq("id", data.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!team) throw new Error("팀을 찾을 수 없습니다.");
    const { data: mems } = await supabaseAdmin
      .from("team_members")
      .select("user_id, created_at")
      .eq("team_id", data.id)
      .is("deleted_at", null);

    const userIds = (mems ?? []).map((m: any) => m.user_id);
    let members: any[] = [];
    if (userIds.length > 0) {
      const { data: ext } = await supabaseAdmin
        .from("external_students")
        .select("auth_user_id, name, phone, school, grade")
        .in("auth_user_id", userIds);
      const map = new Map((ext ?? []).map((e: any) => [e.auth_user_id, e]));
      members = (mems ?? []).map((m: any) => {
        const e: any = map.get(m.user_id);
        return {
          user_id: m.user_id as string,
          name: e?.name ?? "",
          phone: e?.phone ?? "",
          school: e?.school ?? "",
          grade: e?.grade ?? "",
          created_at: m.created_at as string,
        };
      });
    }
    return { ...team, members };
  });

export const addTeamMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ teamId: z.string().uuid(), userId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("team_members")
      .upsert(
        { team_id: data.teamId, user_id: data.userId, deleted_at: null, deleted_by: null },
        { onConflict: "team_id,user_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removeTeamMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ teamId: z.string().uuid(), userId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("team_members")
      .update({ deleted_at: new Date().toISOString(), deleted_by: context.userId })
      .eq("team_id", data.teamId)
      .eq("user_id", data.userId)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });


// 팀 전원을 특정 수강반에 일괄 배정
export const assignTeamToClass = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ teamId: z.string().uuid(), classId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: mems, error: e1 } = await supabaseAdmin
      .from("team_members")
      .select("user_id")
      .eq("team_id", data.teamId)
      .is("deleted_at", null);
    if (e1) throw new Error(e1.message);
    const userIds = (mems ?? []).map((m: any) => m.user_id);
    if (userIds.length === 0) return { assigned: 0 };
    const rows = userIds.map((uid) => ({ class_id: data.classId, user_id: uid, deleted_at: null, deleted_by: null }));
    const { error } = await supabaseAdmin
      .from("class_students")
      .upsert(rows, { onConflict: "class_id,user_id" });
    if (error) throw new Error(error.message);
    return { assigned: userIds.length };
  });


// 팀 대상 메시지 발송
export const sendTeamMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        teamId: z.string().uuid(),
        subject: z.string().min(1).max(200),
        body: z.string().min(1).max(5000),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("team_messages").insert({
      team_id: data.teamId,
      subject: data.subject,
      body: data.body,
      sent_by: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listTeamMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ teamId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("team_messages")
      .select("id, subject, body, created_at")
      .eq("team_id", data.teamId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// 내 메시지함 (학생용)
export const listMyMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: mems } = await supabaseAdmin
      .from("team_members")
      .select("team_id")
      .eq("user_id", context.userId)
      .is("deleted_at", null);
    const teamIds = (mems ?? []).map((r: any) => r.team_id);
    if (teamIds.length === 0) return [];
    const { data: msgs } = await supabaseAdmin
      .from("team_messages")
      .select("id, team_id, subject, body, created_at")
      .in("team_id", teamIds)
      .order("created_at", { ascending: false })
      .limit(50);
    const { data: teams } = await supabaseAdmin
      .from("teams")
      .select("id, name")
      .in("id", teamIds)
      .is("deleted_at", null);

    const nameMap = new Map((teams ?? []).map((t: any) => [t.id, t.name]));
    return (msgs ?? []).map((m: any) => ({ ...m, team_name: nameMap.get(m.team_id) ?? "" }));
  });

// 수강반 목록 (일괄 배정 셀렉트용)
export const listAllClassesForAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("classes")
      .select("id, name")
      .is("deleted_at", null)
      .order("name");

    if (error) throw new Error(error.message);
    return data ?? [];
  });

// 승인된 학생만 검색 (팀 멤버 추가용)
export const searchApprovedStudents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ query: z.string().min(1).max(100) }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const tokens = parseStudentSearchTokens(data.query);
    if (tokens.length === 0) return [];

    const byId = new Map<string, any>();
    for (const token of tokens) {
      if (byId.size >= MAX_STUDENT_SEARCH_RESULTS) break;
      let builder = supabaseAdmin
        .from("external_students")
        .select("auth_user_id, name, phone, school, grade")
        .not("auth_user_id", "is", null)
        .eq("is_deleted", false)
        .order("name")
        .limit(PER_TOKEN_FETCH_LIMIT);
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

    const ids = Array.from(byId.keys());
    if (ids.length === 0) return [];
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "student")
      .is("deleted_at", null)
      .in("user_id", ids);
    const approved = new Set((roles ?? []).map((r: any) => r.user_id));
    return ids
      .filter((id) => approved.has(id))
      .slice(0, MAX_STUDENT_SEARCH_RESULTS)
      .map((id) => {
        const r = byId.get(id);
        return {
          user_id: id,
          name: r.name as string,
          phone: (r.phone as string) ?? "",
          school: (r.school as string) ?? "",
          grade: (r.grade as string) ?? "",
        };
      });
  });

