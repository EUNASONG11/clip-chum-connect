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
