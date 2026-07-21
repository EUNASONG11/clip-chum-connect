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

export const deleteComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("comments").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
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
    const { error } = await context.supabase.from("bookmarks").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
