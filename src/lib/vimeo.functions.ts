import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const VIMEO_API = "https://api.vimeo.com";

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("관리자만 접근할 수 있습니다.");
}

async function vimeoFetch(path: string, init: RequestInit = {}) {
  const token = process.env.VIMEO_ACCESS_TOKEN;
  if (!token) throw new Error("VIMEO_ACCESS_TOKEN 이 설정되지 않았습니다.");
  const res = await fetch(`${VIMEO_API}${path}`, {
    ...init,
    headers: {
      Authorization: `bearer ${token}`,
      Accept: "application/vnd.vimeo.*+json;version=3.4",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = body?.error || body?.developer_message || `Vimeo API 오류 (${res.status})`;
    throw new Error(msg);
  }
  return body;
}

// 1) Vimeo TUS 업로드 세션 생성 (관리자)
export const createVimeoUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        name: z.string().min(1).max(200),
        description: z.string().max(5000).optional().nullable(),
        size: z.number().int().positive(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);

    const body = await vimeoFetch("/me/videos", {
      method: "POST",
      body: JSON.stringify({
        upload: { approach: "tus", size: data.size },
        name: data.name,
        description: data.description ?? undefined,
        privacy: { view: "unlisted", embed: "public" },
        embed: { buttons: { like: false, watchlater: false, share: false } },
      }),
    });

    return {
      uploadLink: body.upload.upload_link as string,
      uri: body.uri as string, // "/videos/12345"
      videoId: (body.uri as string).split("/").pop() as string,
      playerEmbedUrl: body.player_embed_url as string | null,
    };
  });

// 2) 업로드 완료 후 DB 저장
export const finalizeVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        uri: z.string(),
        title: z.string().min(1).max(200),
        description: z.string().max(5000).optional().nullable(),
        class_id: z.string().uuid().nullable().optional(),
        is_published: z.boolean().optional(),
        sort_order: z.number().int().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const videoId = data.uri.split("/").pop()!;

    // Vimeo 에서 메타 재조회
    const v = await vimeoFetch(`/videos/${videoId}`);
    const status: string = v?.upload?.status === "complete" ? "ready" : v?.status ?? "uploading";
    const thumb = v?.pictures?.sizes?.[v.pictures.sizes.length - 1]?.link ?? null;

    const { data: row, error } = await context.supabase
      .from("videos")
      .insert({
        title: data.title,
        description: data.description ?? null,
        vimeo_uri: data.uri,
        vimeo_video_id: videoId,
        player_embed_url: v?.player_embed_url ?? null,
        thumbnail_url: thumb,
        duration: v?.duration ?? null,
        status,
        created_by: context.userId,
        class_id: data.class_id ?? null,
        is_published: data.is_published ?? false,
        sort_order: data.sort_order ?? 0,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });


// 3) Vimeo 상태 재조회 & 갱신
export const refreshVideoStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: existing, error: e1 } = await context.supabase
      .from("videos")
      .select("vimeo_video_id")
      .eq("id", data.id)
      .single();
    if (e1) throw new Error(e1.message);
    const v = await vimeoFetch(`/videos/${existing.vimeo_video_id}`);
    const status: string = v?.upload?.status === "complete" ? "ready" : v?.status ?? "uploading";
    const thumb = v?.pictures?.sizes?.[v.pictures.sizes.length - 1]?.link ?? null;
    const { error } = await context.supabase
      .from("videos")
      .update({
        status,
        thumbnail_url: thumb,
        duration: v?.duration ?? null,
        player_embed_url: v?.player_embed_url ?? null,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { status };
  });

// 4) 삭제 (Vimeo + DB)
export const deleteVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: existing, error: e1 } = await context.supabase
      .from("videos")
      .select("vimeo_video_id")
      .eq("id", data.id)
      .single();
    if (e1) throw new Error(e1.message);

    try {
      await vimeoFetch(`/videos/${existing.vimeo_video_id}`, { method: "DELETE" });
    } catch (err) {
      // 이미 삭제된 경우 무시
      console.error("Vimeo delete error", err);
    }

    const { error } = await context.supabase.from("videos").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// 5) 내가 관리자냐
export const getMyRole = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    return { isAdmin: Boolean(data), userId: context.userId };
  });

// 6) 관리자 승격 (부트스트랩): 관리자 아무도 없으면 자기 자신을 admin 으로
export const claimAdminIfNone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count, error: cErr } = await supabaseAdmin
      .from("user_roles")
      .select("*", { count: "exact", head: true })
      .eq("role", "admin");
    if (cErr) throw new Error(cErr.message);
    if ((count ?? 0) > 0) return { claimed: false };
    const { error } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: context.userId, role: "admin" });
    if (error) throw new Error(error.message);
    return { claimed: true };
  });

// 6-1) 로그인 사용자가 학생 역할이 없으면 자동 부여
export const ensureStudentRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count } = await supabaseAdmin
      .from("user_roles")
      .select("*", { count: "exact", head: true })
      .eq("user_id", context.userId);
    if ((count ?? 0) === 0) {
      await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: context.userId, role: "student" });
    }
    return { ok: true };
  });

// 6-2) 사용자 목록 (관리자 전용)
export const listUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: users, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
    if (error) throw new Error(error.message);
    const { data: roles } = await supabaseAdmin.from("user_roles").select("user_id, role");
    const map = new Map<string, string[]>();
    (roles ?? []).forEach((r: any) => {
      const list = map.get(r.user_id) ?? [];
      list.push(r.role);
      map.set(r.user_id, list);
    });
    return users.users.map((u) => ({
      id: u.id,
      email: u.email ?? "",
      created_at: u.created_at,
      roles: map.get(u.id) ?? [],
    }));
  });

// 6-3) 관리자 권한 부여 (이메일로)
export const grantAdminByEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ email: z.string().email() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: users, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
    if (error) throw new Error(error.message);
    const target = users.users.find((u) => (u.email ?? "").toLowerCase() === data.email.toLowerCase());
    if (!target) throw new Error("해당 이메일로 가입된 사용자가 없습니다.");
    const { error: insErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: target.id, role: "admin" });
    if (insErr && !insErr.message.includes("duplicate")) throw new Error(insErr.message);
    return { ok: true, userId: target.id };
  });

// 6-4) 관리자 권한 회수
export const revokeAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.userId === context.userId) throw new Error("자기 자신의 관리자 권한은 회수할 수 없습니다.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", data.userId)
      .eq("role", "admin");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// 7) YouTube 링크 추가
function parseYoutubeId(url: string): string | null {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
    if (host.endsWith("youtube.com")) {
      if (u.pathname === "/watch") return u.searchParams.get("v");
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts[0] === "embed" || parts[0] === "shorts" || parts[0] === "v") return parts[1] ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

export const addYoutubeVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        url: z.string().url(),
        title: z.string().min(1).max(200),
        description: z.string().max(5000).optional().nullable(),
        class_id: z.string().uuid().nullable().optional(),
        is_published: z.boolean().optional(),
        sort_order: z.number().int().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const ytId = parseYoutubeId(data.url);
    if (!ytId) throw new Error("유효한 YouTube 링크가 아닙니다.");

    const { data: row, error } = await context.supabase
      .from("videos")
      .insert({
        title: data.title,
        description: data.description ?? null,
        source: "youtube",
        external_video_id: ytId,
        external_url: `https://www.youtube.com/watch?v=${ytId}`,
        player_embed_url: `https://www.youtube.com/embed/${ytId}`,
        thumbnail_url: `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`,
        status: "ready",
        created_by: context.userId,
        class_id: data.class_id ?? null,
        is_published: data.is_published ?? false,
        sort_order: data.sort_order ?? 0,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

