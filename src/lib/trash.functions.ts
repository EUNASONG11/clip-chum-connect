import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ENTITIES = [
  "videos",
  "classes",
  "teams",
  "class_students",
  "class_instructors",
  "class_folders",
  "class_categories",
  "team_members",
  "comments",
  "bookmarks",
] as const;

type Entity = (typeof ENTITIES)[number];

const ENTITY_LABEL: Record<Entity, string> = {
  videos: "영상",
  classes: "수강반",
  teams: "팀",
  class_students: "수강반 학생 배정",
  class_instructors: "수강반 강사 배정",
  class_folders: "수강반 폴더",
  class_categories: "수강반 카테고리",
  team_members: "팀 멤버",
  comments: "댓글",
  bookmarks: "북마크",
};

// Composite-key tables use (a,b); single-PK tables use id.
const COMPOSITE: Partial<Record<Entity, [string, string]>> = {
  class_students: ["class_id", "user_id"],
  team_members: ["team_id", "user_id"],
};

const SELECT_COLS: Record<Entity, string> = {
  videos: "id, title, deleted_at, deleted_by, class_id",
  classes: "id, name, deleted_at, deleted_by",
  teams: "id, name, deleted_at, deleted_by",
  class_students: "class_id, user_id, deleted_at, deleted_by",
  class_instructors: "id, class_id, instructor_user_id, deleted_at, deleted_by",
  class_folders: "id, class_id, name, deleted_at, deleted_by",
  class_categories: "id, name, deleted_at, deleted_by",
  team_members: "team_id, user_id, deleted_at, deleted_by",
  comments: "id, video_id, user_id, body, deleted_at, deleted_by",
  bookmarks: "id, video_id, user_id, note, seconds, deleted_at, deleted_by",
};

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("관리자만 접근할 수 있습니다.");
}

export const listTrash = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { entity: Entity; limit?: number; offset?: number }) =>
    z
      .object({
        entity: z.enum(ENTITIES),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error, count } = await supabaseAdmin
      .from(data.entity)
      .select(SELECT_COLS[data.entity], { count: "exact" })
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], count: count ?? 0 };
  });

export const listTrashCounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const results = await Promise.all(
      ENTITIES.map(async (e) => {
        const { count } = await supabaseAdmin
          .from(e)
          .select("*", { count: "exact", head: true })
          .not("deleted_at", "is", null);
        return [e, count ?? 0] as const;
      }),
    );
    return {
      counts: Object.fromEntries(results) as Record<Entity, number>,
      labels: ENTITY_LABEL,
      entities: ENTITIES as unknown as string[],
    };
  });

function applyPkFilter(query: any, entity: Entity, id: string) {
  const comp = COMPOSITE[entity];
  if (comp) {
    const [a, b] = id.split("::");
    if (!a || !b) throw new Error("잘못된 식별자입니다.");
    return query.eq(comp[0], a).eq(comp[1], b);
  }
  return query.eq("id", id);
}

export const restoreItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { entity: Entity; id: string }) =>
    z.object({ entity: z.enum(ENTITIES), id: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const q = applyPkFilter(
      supabaseAdmin.from(data.entity).update({ deleted_at: null, deleted_by: null }),
      data.entity,
      data.id,
    );
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const purgeItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { entity: Entity; id: string }) =>
    z.object({ entity: z.enum(ENTITIES), id: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const q = applyPkFilter(
      supabaseAdmin.from(data.entity).delete(),
      data.entity,
      data.id,
    );
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true };
  });
