import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// ---------- Comments ----------
export const listComments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ videoId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("comments")
      .select("id, body, user_id, created_at, updated_at")
      .eq("video_id", data.videoId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    if (!rows || rows.length === 0) return [];
    // 이메일을 서버에서 조회 (관리자 API)
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: users } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
    const map = new Map(users.users.map((u) => [u.id, u.email ?? ""]));
    return rows.map((r: any) => ({
      id: r.id as string,
      body: r.body as string,
      user_id: r.user_id as string,
      author_email: map.get(r.user_id) ?? "",
      created_at: r.created_at as string,
      is_mine: r.user_id === context.userId,
    }));
  });

export const addComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ videoId: z.string().uuid(), body: z.string().min(1).max(2000) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("comments")
      .insert({ video_id: data.videoId, user_id: context.userId, body: data.body });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ id: z.string().uuid(), body: z.string().min(1).max(2000) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("comments")
      .update({ body: data.body })
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .is("deleted_at", null)
      .select("id");
    if (error) throw new Error(error.message);
    if (!rows || rows.length === 0) throw new Error("본인 댓글만 수정할 수 있습니다.");
    return { ok: true };
  });

export const deleteComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("comments")
      .update({ deleted_at: new Date().toISOString(), deleted_by: context.userId })
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .select("id");
    if (error) throw new Error(error.message);
    if (!rows || rows.length === 0) throw new Error("본인 댓글만 삭제할 수 있습니다.");
    return { ok: true };
  });




// ---------- Bookmarks ----------
export const listMyBookmarks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ videoId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("bookmarks")
      .select("id, seconds, note, created_at")
      .eq("user_id", context.userId)
      .eq("video_id", data.videoId)
      .order("seconds", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const addBookmark = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        videoId: z.string().uuid(),
        seconds: z.number().int().min(0),
        note: z.string().max(500).optional().nullable(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("bookmarks").insert({
      user_id: context.userId,
      video_id: data.videoId,
      seconds: data.seconds,
      note: data.note ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteBookmark = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("bookmarks")
      .update({ deleted_at: new Date().toISOString(), deleted_by: context.userId })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });


// ---------- Admin/Instructor read helpers ----------
async function assertVideoAccess(context: { supabase: any; userId: string }, videoId: string) {
  const { data: isAdminRes } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (isAdminRes) return { isAdmin: true };
  const { data: isInstructorRes } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "instructor",
  });
  if (!isInstructorRes) throw new Error("관리자 또는 강사만 접근할 수 있습니다.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: v } = await supabaseAdmin
    .from("videos")
    .select("class_id")
    .eq("id", videoId)
    .maybeSingle();
  if (!v?.class_id) throw new Error("영상을 찾을 수 없습니다.");
  const { data: assigned } = await supabaseAdmin
    .from("class_instructors")
    .select("class_id")
    .eq("class_id", v.class_id)
    .eq("instructor_user_id", context.userId)
    .maybeSingle();
  if (assigned) return { isAdmin: false };
  const { data: cls } = await supabaseAdmin
    .from("classes")
    .select("created_by")
    .eq("id", v.class_id)
    .maybeSingle();
  if (cls?.created_by === context.userId) return { isAdmin: false };
  throw new Error("해당 영상에 대한 권한이 없습니다.");
}

async function fetchUserLabels(userIds: string[]) {
  if (userIds.length === 0) return new Map<string, { name: string; phone: string | null; email: string | null }>();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const unique = Array.from(new Set(userIds));
  const map = new Map<string, { name: string; phone: string | null; email: string | null }>();
  const { data: ext } = await supabaseAdmin
    .from("external_students")
    .select("auth_user_id, name, phone")
    .in("auth_user_id", unique);
  for (const e of ext ?? []) {
    const uid = (e as any).auth_user_id as string | null;
    if (uid) map.set(uid, { name: ((e as any).name as string) ?? "", phone: ((e as any).phone as string) ?? null, email: null });
  }
  const missing = unique.filter((u) => !map.has(u));
  for (const uid of missing) {
    try {
      const { data } = await supabaseAdmin.auth.admin.getUserById(uid);
      const email = data?.user?.email ?? null;
      map.set(uid, { name: email ?? "", phone: null, email });
    } catch {
      map.set(uid, { name: "", phone: null, email: null });
    }
  }
  return map;
}

export const listVideoAllComments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ videoId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertVideoAccess(context, data.videoId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("comments")
      .select("id, body, user_id, created_at")
      .eq("video_id", data.videoId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const labels = await fetchUserLabels((rows ?? []).map((r: any) => r.user_id as string));
    return (rows ?? []).map((r: any) => {
      const l = labels.get(r.user_id as string);
      return {
        id: r.id as string,
        body: r.body as string,
        user_id: r.user_id as string,
        author_name: l?.name || l?.email || "알 수 없음",
        author_phone: l?.phone ?? null,
        created_at: r.created_at as string,
      };
    });
  });

export const listVideoAllBookmarks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ videoId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertVideoAccess(context, data.videoId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("bookmarks")
      .select("id, seconds, note, user_id, created_at")
      .eq("video_id", data.videoId)
      .order("seconds", { ascending: true });
    if (error) throw new Error(error.message);
    const labels = await fetchUserLabels((rows ?? []).map((r: any) => r.user_id as string));
    return (rows ?? []).map((r: any) => {
      const l = labels.get(r.user_id as string);
      return {
        id: r.id as string,
        seconds: r.seconds as number,
        note: (r.note as string) ?? null,
        user_id: r.user_id as string,
        author_name: l?.name || l?.email || "알 수 없음",
        author_phone: l?.phone ?? null,
        created_at: r.created_at as string,
      };
    });
  });
