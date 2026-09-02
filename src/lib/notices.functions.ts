import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

export type PublicNotice = {
  id: string;
  title: string;
  body: string;
  branch: string | null;
  is_pinned: boolean;
  created_at: string;
};

/** 로그인 없이 조회하는 공개 공지 목록 */
export const listPublicNotices = createServerFn({ method: "GET" }).handler(async () => {
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  const url = process.env["SUPABASE_URL"]!;
  const client = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) {
          h.delete("Authorization");
        }
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });

  const { data, error } = await client
    .from("notices")
    .select("id, title, body, branch, is_pinned, created_at")
    .eq("is_published", true)
    .is("deleted_at", null)
    .order("is_pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw new Error(error.message);
  return { notices: (data ?? []) as PublicNotice[] };
});

async function assertNoticeManager(context: { supabase: any; userId: string }) {
  const [{ data: admin }, { data: branch }] = await Promise.all([
    context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
    context.supabase.rpc("branch_admin_branch", { _uid: context.userId }),
  ]);
  if (!admin && !branch) throw new Error("공지 관리 권한이 없습니다.");
  return { isAdmin: !!admin, branch: (branch as string | null) ?? null };
}

/** 관리자/중간 관리자용 전체 공지 목록(숨김 포함) */
export const listManagedNotices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const scope = await assertNoticeManager(context as any);
    const { data, error } = await context.supabase
      .from("notices")
      .select("id, title, body, branch, is_pinned, is_published, created_at, updated_at")
      .is("deleted_at", null)
      .order("is_pinned", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return { notices: data ?? [], scope };
  });

const noticeInput = z.object({
  title: z.string().trim().min(1, "제목을 입력하세요."),
  body: z.string().default(""),
  branch: z.string().trim().nullable().optional(),
  isPinned: z.boolean().default(false),
  isPublished: z.boolean().default(true),
});

export const createNotice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => noticeInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertNoticeManager(context as any);
    const branch = data.branch || null;
    const { error } = await context.supabase.from("notices").insert({
      title: data.title,
      body: data.body,
      branch,
      is_pinned: data.isPinned,
      is_published: data.isPublished,
      created_by: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateNotice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => noticeInput.extend({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertNoticeManager(context as any);
    const { error } = await context.supabase
      .from("notices")
      .update({
        title: data.title,
        body: data.body,
        branch: data.branch || null,
        is_pinned: data.isPinned,
        is_published: data.isPublished,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteNotice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertNoticeManager(context as any);
    const { error } = await context.supabase
      .from("notices")
      .update({ deleted_at: new Date().toISOString(), deleted_by: context.userId })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
