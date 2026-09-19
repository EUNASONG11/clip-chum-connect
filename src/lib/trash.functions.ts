import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { vimeoFetch } from "@/lib/vimeo.functions";


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

function uniqueIds(rows: any[], key: string): string[] {
  return Array.from(new Set(rows.map((r) => r?.[key]).filter((v): v is string => typeof v === "string" && v.length > 0)));
}

async function fetchNameMaps(supabaseAdmin: any, rows: any[]) {
  const userIds = uniqueIds(rows, "user_id");
  const instructorIds = uniqueIds(rows, "instructor_user_id");
  const allPeopleIds = Array.from(new Set(userIds.concat(instructorIds)));
  const classIds = uniqueIds(rows, "class_id");
  const teamIds = uniqueIds(rows, "team_id");
  const videoIds = uniqueIds(rows, "video_id");

  const [students, instructors, classes, teams, videos] = await Promise.all([
    userIds.length > 0
      ? supabaseAdmin.from("external_students").select("auth_user_id, name").in("auth_user_id", userIds)
      : Promise.resolve({ data: [] }),
    allPeopleIds.length > 0
      ? supabaseAdmin.from("instructors").select("auth_user_id, name").in("auth_user_id", allPeopleIds)
      : Promise.resolve({ data: [] }),
    classIds.length > 0
      ? supabaseAdmin.from("classes").select("id, name").in("id", classIds)
      : Promise.resolve({ data: [] }),
    teamIds.length > 0
      ? supabaseAdmin.from("teams").select("id, name").in("id", teamIds)
      : Promise.resolve({ data: [] }),
    videoIds.length > 0
      ? supabaseAdmin.from("videos").select("id, title").in("id", videoIds)
      : Promise.resolve({ data: [] }),
  ]);

  const peopleNames = new Map<string, string>();
  for (const r of (instructors.data ?? []) as any[]) {
    if (r.auth_user_id && r.name) peopleNames.set(r.auth_user_id, r.name);
  }
  // 학생 이름은 강사 이름보다 우선할 필요는 없지만, 같은 auth_user_id가 두 테이블에
  // 없으므로 순서 무관합니다.
  for (const r of (students.data ?? []) as any[]) {
    if (r.auth_user_id && r.name) peopleNames.set(r.auth_user_id, r.name);
  }

  const toMap = (data: any[] | null, key: string, valueKey?: string) =>
    new Map((data ?? []).map((r: any) => [r[key], r[valueKey ?? "name"] ?? ""]));

  return {
    peopleNames,
    classNames: toMap(classes.data, "id"),
    teamNames: toMap(teams.data, "id"),
    videoTitles: toMap(videos.data, "id", "title"),
  };
}

async function checkAdmin(context: { supabase: any; userId: string }): Promise<boolean> {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  return Boolean(data);
}

async function assertAdmin(context: { supabase: any; userId: string }) {
  if (!(await checkAdmin(context))) throw new Error("관리자만 접근할 수 있습니다.");
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
    const isAdmin = await checkAdmin(context);
    // 관리자가 아니면 영상(본인 업로드분)만 조회 가능
    if (!isAdmin && data.entity !== "videos") {
      throw new Error("관리자만 접근할 수 있습니다.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from(data.entity)
      .select(SELECT_COLS[data.entity], { count: "exact" })
      .not("deleted_at", "is", null);
    if (!isAdmin) q = q.eq("created_by", context.userId);
    const { data: rows, error, count } = await q
      .order("deleted_at", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);
    if (error) throw new Error(error.message);

    const maps = await fetchNameMaps(supabaseAdmin, rows ?? []);
    const enriched = (rows ?? []).map((row: any) => ({
      ...row,
      class_name: maps.classNames.get(row.class_id) || "",
      student_name: maps.peopleNames.get(row.user_id) || "",
      instructor_name: maps.peopleNames.get(row.instructor_user_id) || "",
      team_name: maps.teamNames.get(row.team_id) || "",
      member_name: maps.peopleNames.get(row.user_id) || "",
      video_title: maps.videoTitles.get(row.video_id) || "",
    }));

    return { rows: enriched, count: count ?? 0 };
  });

export const listTrashCounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const isAdmin = await checkAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // 관리자가 아니면 영상 탭만, 본인 업로드분 개수만 제공
    const entities: readonly Entity[] = isAdmin ? ENTITIES : (["videos"] as const);
    const results = await Promise.all(
      entities.map(async (e) => {
        let q = supabaseAdmin
          .from(e)
          .select("*", { count: "exact", head: true })
          .not("deleted_at", "is", null);
        if (!isAdmin) q = q.eq("created_by", context.userId);
        const { count } = await q;
        return [e, count ?? 0] as const;
      }),
    );
    return {
      counts: Object.fromEntries(results) as Record<Entity, number>,
      labels: ENTITY_LABEL,
      entities: entities as unknown as string[],
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let vimeoError: string | null = null;

    if (data.entity === "videos") {
      const { data: row } = await supabaseAdmin
        .from("videos")
        .select("source, vimeo_video_id, created_by")
        .eq("id", data.id)
        .maybeSingle();
      // 영상은 최고 관리자 또는 업로더 본인만 영구 삭제 가능
      if (!row) throw new Error("삭제할 영상을 찾을 수 없습니다.");
      const { data: isAdmin } = await context.supabase.rpc("has_role", {
        _user_id: context.userId,
        _role: "admin",
      });
      if (!isAdmin && row.created_by !== context.userId) {
        throw new Error("최고 관리자 또는 영상을 업로드한 사람만 영구 삭제할 수 있습니다.");
      }
      if (row?.source === "vimeo" && row?.vimeo_video_id) {
        try {
          await vimeoFetch(`/videos/${row.vimeo_video_id}`, { method: "DELETE" });
        } catch (e: any) {
          vimeoError = e?.message ?? "Vimeo 삭제 실패";
        }
      }
    } else {
      await assertAdmin(context);
    }

    const q = applyPkFilter(
      supabaseAdmin.from(data.entity).delete(),
      data.entity,
      data.id,
    );
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true, vimeoError };
  });

