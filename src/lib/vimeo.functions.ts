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

async function assertAdminOrInstructor(context: { supabase: any; userId: string }) {
  const [{ data: admin }, { data: instructor }] = await Promise.all([
    context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
    context.supabase.rpc("has_role", { _user_id: context.userId, _role: "instructor" }),
  ]);
  if (!admin && !instructor) throw new Error("관리자 또는 강사만 접근할 수 있습니다.");
}

async function assertOwnClassOrAdmin(
  context: { supabase: any; userId: string },
  classId: string | null | undefined,
) {
  const admin = !!(await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  }).then((r: any) => r.data));
  if (admin) return;
  const instructor = !!(await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "instructor",
  }).then((r: any) => r.data));
  if (!instructor) throw new Error("해당 수강반에 대한 권한이 없습니다.");
  if (!classId) throw new Error("수강반을 지정해야 합니다.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: cls } = await supabaseAdmin
    .from("classes")
    .select("created_by")
    .eq("id", classId)
    .is("deleted_at", null)
    .maybeSingle();
  if (cls?.created_by === context.userId) return;
  const { data: assigned } = await supabaseAdmin
    .from("class_instructors")
    .select("class_id")
    .eq("class_id", classId)
    .eq("instructor_user_id", context.userId)
    .is("deleted_at", null)
    .maybeSingle();

  if (assigned) return;
  throw new Error("해당 수강반에 대한 권한이 없습니다.");
}

export async function vimeoFetch(path: string, init: RequestInit = {}) {
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
    await assertAdminOrInstructor(context);

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
        folder_id: z.string().uuid().nullable().optional(),
        is_published: z.boolean().optional(),
        sort_order: z.number().int().optional(),
        allow_seek: z.boolean().optional(),
        max_playback_rate: z.number().optional(),
        completion_ratio: z.number().min(0).max(1).optional(),
        rewatch_allow_seek: z.boolean().nullable().optional(),
        rewatch_max_playback_rate: z.number().nullable().optional(),

      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdminOrInstructor(context);
    await assertOwnClassOrAdmin(context, data.class_id);
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
        folder_id: data.folder_id ?? null,
        is_published: data.is_published ?? false,
        sort_order: data.sort_order ?? 0,
        allow_seek: data.allow_seek ?? false,
        max_playback_rate: data.max_playback_rate ?? 1,
        completion_ratio: data.completion_ratio ?? 1,
        rewatch_allow_seek: data.rewatch_allow_seek ?? null,
        rewatch_max_playback_rate: data.rewatch_max_playback_rate ?? null,

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
    await assertAdminOrInstructor(context);
    const { data: existing, error: e1 } = await context.supabase
      .from("videos")
      .select("vimeo_video_id, class_id")
      .eq("id", data.id)
      .single();
    if (e1) throw new Error(e1.message);
    await assertOwnClassOrAdmin(context, existing.class_id);
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
    await assertAdminOrInstructor(context);
    const { data: existing, error: e1 } = await context.supabase
      .from("videos")
      .select("vimeo_video_id, class_id")
      .eq("id", data.id)
      .single();
    if (e1) throw new Error(e1.message);
    await assertOwnClassOrAdmin(context, existing.class_id);

    // 소프트 삭제: Vimeo 원본은 유지, 휴지통에서 영구삭제 시 Vimeo도 삭제
    const { error } = await context.supabase
      .from("videos")
      .update({ deleted_at: new Date().toISOString(), deleted_by: context.userId })
      .eq("id", data.id);
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

// 5-1) 내 표시 이름 (강사는 instructors.name, 학생은 external_students.name, 그 외 이메일)
export const getMyDisplayName = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: inst } = await supabaseAdmin
      .from("instructors")
      .select("name")
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    if ((inst as any)?.name) return { name: (inst as any).name };
    const { data } = await supabaseAdmin
      .from("external_students")
      .select("name")
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    return { name: (data as any)?.name ?? null };
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

// 6-1) 로그인 사용자가 아무 역할도 없으면 '승인 대기(pending)' 부여
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
        .insert({ user_id: context.userId, role: "pending" });
    }
    return { ok: true };
  });

// 6-1b) 내 상태 확인
export const getMyStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const roles = (data ?? []).map((r: any) => r.role as string);
    return {
      isAdmin: roles.includes("admin"),
      isStudent: roles.includes("student"),
      isInstructor: roles.includes("instructor"),
      isPending: !roles.includes("admin") && !roles.includes("student") && !roles.includes("instructor"),
    };
  });


// 6-2) 사용자 목록 (관리자 전용) — 수강반 수 포함
export const listUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const retry = async <T,>(fn: () => Promise<T>, label: string, tries = 4): Promise<T> => {
      let lastErr: unknown;
      for (let i = 0; i < tries; i++) {
        try {
          return await fn();
        } catch (e) {
          lastErr = e;
          await new Promise((r) => setTimeout(r, 300 * (i + 1)));
        }
      }
      throw new Error(`${label} 실패: ${(lastErr as any)?.message ?? lastErr}`);
    };

    // auth.users 전체 페이징 조회 — 1페이지로 total 확인 후 나머지 페이지 병렬 요청
    const allAuthUsers: any[] = [];
    {
      const perPage = 1000;
      const first = await retry(
        () => supabaseAdmin.auth.admin.listUsers({ page: 1, perPage }),
        `auth.listUsers page 1`,
      );
      if ((first as any).error) throw new Error((first as any).error.message);
      const firstUsers = first.data?.users ?? [];
      allAuthUsers.push(...firstUsers);
      const total = (first.data as any)?.total ?? firstUsers.length;
      const totalPages = Math.max(1, Math.ceil(total / perPage));
      if (totalPages > 1) {
        const pages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
        // 병렬 처리 (동시 6개씩)
        const concurrency = 6;
        for (let i = 0; i < pages.length; i += concurrency) {
          const batch = pages.slice(i, i + concurrency);
          const results = await Promise.all(
            batch.map((page) =>
              retry(
                () => supabaseAdmin.auth.admin.listUsers({ page, perPage }),
                `auth.listUsers page ${page}`,
              ),
            ),
          );
          for (const r of results) {
            if ((r as any).error) throw new Error((r as any).error.message);
            allAuthUsers.push(...(r.data?.users ?? []));
          }
        }
      }
    }

    // PostgREST 기본 1000행 제한 회피 — 전체 페이징 조회
    const fetchAllRows = async <T,>(
      table: "user_roles" | "class_students",
      columns: string,
      label: string,
    ): Promise<T[]> => {
      const out: T[] = [];
      const size = 1000;
      let from = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data, error: e } = await retry(
          async () =>
            await supabaseAdmin
              .from(table)
              .select(columns)
              .is("deleted_at", null)
              .range(from, from + size - 1),
          `${label} range ${from}`,
        );
        if (e) throw new Error(e.message);
        const chunk = (data ?? []) as T[];
        out.push(...chunk);
        if (chunk.length < size) break;
        from += size;
      }
      return out;
    };

    const [roleRows, classStudentRows] = await Promise.all([
      fetchAllRows<{ user_id: string; role: string }>("user_roles", "user_id, role", "user_roles"),
      fetchAllRows<{ user_id: string }>("class_students", "user_id", "class_students"),
    ]);
    const rolesRes = { data: roleRows };
    const csRes = { data: classStudentRows };


    const userIds = allAuthUsers.map((u) => u.id);

    // external_students 전체 페이징 조회 후 로컬 매칭
    const extRows: { auth_user_id: string | null; name: string | null; phone: string | null; enrollment_status: string | null; temp_password: string | null; branch: string | null }[] = [];
    {
      const size = 500;
      let from = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data, error: e } = await retry(
          async () =>
            await supabaseAdmin
              .from("external_students")
              .select("auth_user_id, name, phone, enrollment_status, temp_password, branch")
              .not("auth_user_id", "is", null)
              .range(from, from + size - 1),
          `external_students range ${from}`,
        );
        if (e) throw new Error(e.message);
        const chunk = data ?? [];
        extRows.push(...chunk);
        if (chunk.length < size) break;
        from += size;
      }
    }

    const roleMap = new Map<string, string[]>();
    (rolesRes.data ?? []).forEach((r: any) => {
      const list = roleMap.get(r.user_id) ?? [];
      list.push(r.role);
      roleMap.set(r.user_id, list);
    });
    const classCount = new Map<string, number>();
    (csRes.data ?? []).forEach((r: any) => {
      classCount.set(r.user_id, (classCount.get(r.user_id) ?? 0) + 1);
    });
    const extMap = new Map<string, { name: string | null; phone: string | null; enrollment_status: string | null; temp_password: string | null; branch: string | null }>();
    extRows.forEach((r) => {
      if (r.auth_user_id) extMap.set(r.auth_user_id, { name: r.name, phone: r.phone, enrollment_status: r.enrollment_status, temp_password: r.temp_password, branch: r.branch });
    });

    // instructors 테이블에서 강사 정보 조회
    const { data: instRows } = await retry(
      async () => await supabaseAdmin.from("instructors").select("auth_user_id, name, phone, branch, cohort, cohorts").not("auth_user_id", "is", null),
      "instructors",
    );
    const instMap = new Map<string, { name: string | null; phone: string | null; branch: string | null; cohort: string | null; cohorts: string[] }>();
    (instRows ?? []).forEach((r: any) => {
      if (r.auth_user_id) instMap.set(r.auth_user_id, { name: r.name, phone: r.phone, branch: r.branch, cohort: r.cohort ?? null, cohorts: ((r as any).cohorts ?? []) as string[] });
    });

    const formatPhone = (p: string | null | undefined) => {
      if (!p) return "";
      const d = p.replace(/[^0-9]/g, "");
      if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
      if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
      return p;
    };
    return allAuthUsers
      .map((u: any) => {
        const roles = roleMap.get(u.id) ?? [];
        const isAdmin = roles.includes("admin");
        const isStudent = roles.includes("student");
        const isInstructor = roles.includes("instructor");
        const isPending = !isAdmin && !isStudent && !isInstructor;
        const ext = extMap.get(u.id);
        const inst = instMap.get(u.id);
        return {
          id: u.id,
          email: u.email ?? "",
          nickname:
            inst?.name ??
            ext?.name ??
            (u.user_metadata as any)?.nickname ??
            (u.email ?? "").split("@")[0] ??
            "",
          phone: formatPhone(inst?.phone ?? ext?.phone),
          created_at: u.created_at,
          roles,
          isAdmin,
          isStudent,
          isInstructor,
          isPending,
          class_count: classCount.get(u.id) ?? 0,
          branch: inst?.branch ?? ext?.branch ?? null,
          cohort: inst?.cohort ?? null,
          cohorts: inst?.cohorts ?? [],
        };
      })
      .filter((u: any) => {
        // 관리자·강사는 external_students 상태와 무관하게 항상 표시
        if (u.isAdmin || u.isInstructor) return true;
        const status = extMap.get(u.id)?.enrollment_status ?? null;
        // enrollment_status가 null이거나 '휴원'인 학생(또는 미승인 학생)은 제외
        if (!status) return !u.isStudent && !u.isPending;
        if (status === "휴원") return !u.isStudent && !u.isPending;
        return true;
      });
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
    await supabaseAdmin.from("user_roles").delete().eq("user_id", target.id).eq("role", "pending");
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

// 6-5) 승인 대기 사용자를 학생/관리자로 승인
export const approveUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        userId: z.string().uuid(),
        role: z.enum(["student", "admin", "instructor"]).default("student"),

      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", data.userId)
      .eq("role", "pending");
    const { error } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: data.userId, role: data.role });
    if (error && !error.message.includes("duplicate")) throw new Error(error.message);
    return { ok: true };
  });

// 6-5b) 승인 대기 사용자 일괄 승인
export const bulkApproveUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        userIds: z.array(z.string().uuid()).min(1).max(2000),
        role: z.enum(["student", "admin", "instructor"]).default("student"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // pending 역할 제거
    await supabaseAdmin
      .from("user_roles")
      .delete()
      .in("user_id", data.userIds)
      .eq("role", "pending");
    // 대상 역할 부여 (중복은 무시)
    const rows = data.userIds.map((user_id) => ({ user_id, role: data.role }));
    const { error } = await supabaseAdmin
      .from("user_roles")
      .upsert(rows, { onConflict: "user_id,role", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    return { ok: true, count: data.userIds.length };
  });

// 6-5c) 승인된 사용자를 승인 대기로 되돌리기
export const revertToPending = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.userId === context.userId) throw new Error("자기 자신은 되돌릴 수 없습니다.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // 기존 역할(student, admin) 제거
    await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", data.userId)
      .in("role", ["student", "admin", "instructor"]);
    // pending 역할 부여
    const { error } = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: data.userId, role: "pending" }, { onConflict: "user_id,role", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// 6-6) 사용자 삭제(가입 거절) - 소프트 삭제: user_roles 를 소프트 삭제하고 auth 계정은 보존
export const rejectUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.userId === context.userId) throw new Error("자기 자신은 삭제할 수 없습니다.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("user_roles")
      .update({ deleted_at: new Date().toISOString(), deleted_by: context.userId })
      .eq("user_id", data.userId)
      .is("deleted_at", null);
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
        url: z.string().trim().min(1),
        title: z.string().min(1).max(200),
        description: z.string().max(5000).optional().nullable(),
        class_id: z.string().uuid().nullable().optional(),
        folder_id: z.string().uuid().nullable().optional(),
        is_published: z.boolean().optional(),
        sort_order: z.number().int().optional(),
        allow_seek: z.boolean().optional(),
        max_playback_rate: z.number().optional(),
        completion_ratio: z.number().min(0).max(1).optional(),
        rewatch_allow_seek: z.boolean().nullable().optional(),
        rewatch_max_playback_rate: z.number().nullable().optional(),

      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdminOrInstructor(context);
    await assertOwnClassOrAdmin(context, data.class_id);
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
        folder_id: data.folder_id ?? null,
        is_published: data.is_published ?? false,
        sort_order: data.sort_order ?? 0,
        allow_seek: data.allow_seek ?? false,
        max_playback_rate: data.max_playback_rate ?? 1,
        completion_ratio: data.completion_ratio ?? 1,
        rewatch_allow_seek: data.rewatch_allow_seek ?? null,
        rewatch_max_playback_rate: data.rewatch_max_playback_rate ?? null,

      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });


// 이메일 존재 여부 확인 (로그인 오류 시 원인 판별용)
export const checkEmailExists = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ email: z.string().email() }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: res, error } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    if (error) throw new Error(error.message);
    const exists = res.users.some(
      (u) => (u.email ?? "").toLowerCase() === data.email.toLowerCase(),
    );
    return { exists };
  });

// 학생 로그인: 이름+전화번호로 미러링된 계정의 이메일/초기 비밀번호를 조회
export const resolveStudentLogin = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        name: z.string().trim().min(1).max(100),
        phone: z.string().trim().min(4).max(30),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const raw = data.phone.trim();
    const phoneDigits = raw.replace(/[^0-9]/g, "");
    const name = data.name.trim();

    // 1) 임시 비밀번호 경로: 이름 + temp_password 정확히 일치하는 학생 우선 조회.
    //    관리자가 발급한 임시 코드는 전화번호 없는 학생용이므로 phone 필터 없음.
    {
      const { data: tempRows, error: tempErr } = await supabaseAdmin
        .from("external_students")
        .select("name, auth_user_id, is_deleted, temp_password")
        .eq("name", name)
        .eq("temp_password", raw)
        .limit(2);
      if (tempErr) throw new Error(tempErr.message);
      const activeTemp = (tempRows ?? []).filter((r) => !r.is_deleted && r.auth_user_id);
      if (activeTemp.length > 1) {
        throw new Error("동일 이름의 임시 코드가 중복됩니다. 관리자에게 문의하세요.");
      }
      if (activeTemp.length === 1) {
        const row = activeTemp[0];
        const { data: userRes, error: userErr } =
          await supabaseAdmin.auth.admin.getUserById(row.auth_user_id!);
        if (userErr || !userRes?.user?.email) {
          throw new Error("계정 정보를 불러올 수 없습니다.");
        }
        return { email: userRes.user.email, initialPassword: raw };
      }
    }

    // 2) 기존 전화번호 경로 — 학생 본인 전화번호 또는 학부모 전화번호와 일치하면 로그인 허용.
    if (phoneDigits.length < 8) {
      throw new Error("전화번호(또는 임시 비밀번호)가 올바르지 않습니다.");
    }

    const { data: rows, error } = await supabaseAdmin
      .from("external_students")
      .select("name, phone, parent_phone, auth_user_id, is_deleted")
      .eq("name", name)
      .or(`phone.eq.${phoneDigits},parent_phone.eq.${phoneDigits}`)
      .limit(3);
    if (error) throw new Error(error.message);

    const active = (rows ?? []).filter((r) => !r.is_deleted);
    if (active.length > 1) {
      throw new Error("동일한 이름/전화번호의 계정이 여러 개 존재합니다. 관리자에게 문의하세요.");
    }

    if (active.length === 1) {
      const row = active[0];
      if (!row.auth_user_id) {
        throw new Error("계정이 아직 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.");
      }
      const { data: userRes, error: userErr } =
        await supabaseAdmin.auth.admin.getUserById(row.auth_user_id);
      if (userErr || !userRes?.user?.email) {
        throw new Error("계정 정보를 불러올 수 없습니다.");
      }
      const initialPassword = phoneDigits.slice(-8);
      // 입력한 전화번호(본인/학부모 무관) 뒷 8자리로 비밀번호를 동기화하여 로그인 보장.
      await supabaseAdmin.auth.admin.updateUserById(row.auth_user_id, {
        password: initialPassword,
      });
      return {
        email: userRes.user.email,
        initialPassword,
      };
    }

    throw new Error("이름 또는 전화번호가 일치하는 계정을 찾을 수 없습니다.");
  });

// ============= 강사 계정 일괄 생성 & 최초 비밀번호 변경 =============

export const bulkCreateInstructorAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: instructors, error } = await supabaseAdmin
      .from("instructors")
      .select("id, name, email, phone, auth_user_id")
      .is("auth_user_id", null);
    if (error) throw new Error(error.message);

    let created = 0;
    let linked = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const inst of instructors ?? []) {
      try {
        const email = (inst.email ?? "").trim().toLowerCase();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          failed++;
          errors.push(`${inst.name}: 이메일 없음 또는 형식 오류`);
          continue;
        }
        let authUserId: string | null = null;

        const { data: created1, error: cErr } = await supabaseAdmin.auth.admin.createUser({
          email,
          password: "12345678",
          email_confirm: true,
          user_metadata: { name: inst.name, source: "instructor-bulk" },
        });

        if (cErr) {
          const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
          const found = list?.users.find((u) => (u.email ?? "").toLowerCase() === email);
          if (found) {
            authUserId = found.id;
            linked++;
          } else {
            failed++;
            errors.push(`${inst.name}: ${cErr.message}`);
            continue;
          }
        } else if (created1?.user) {
          authUserId = created1.user.id;
          created++;
        }

        if (!authUserId) continue;

        await supabaseAdmin
          .from("instructors")
          .update({ auth_user_id: authUserId, must_change_password: true })
          .eq("id", inst.id);

        await supabaseAdmin
          .from("user_roles")
          .upsert({ user_id: authUserId, role: "instructor" }, { onConflict: "user_id,role" });
      } catch (e: any) {
        failed++;
        errors.push(`${inst.name}: ${e.message ?? e}`);
      }
    }

    return { created, linked, failed, total: (instructors ?? []).length, errors: errors.slice(0, 20) };
  });

export const getMyMustChangePassword = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("instructors")
      .select("must_change_password")
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    return { mustChange: !!(data as any)?.must_change_password };
  });

export const clearMyMustChangePassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("instructors")
      .update({ must_change_password: false })
      .eq("auth_user_id", context.userId);
    return { ok: true };
  });

// ============= 강사 명부(로스터) 관리 =============

export const listInstructorRoster = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("instructors")
      .select("id, name, email, phone, branch, cohort, cohorts, auth_user_id, must_change_password")
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const updateInstructorEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        id: z.string().uuid(),
        email: z.string().trim().email().max(255),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = data.email.toLowerCase();
    const { data: row, error: fErr } = await supabaseAdmin
      .from("instructors")
      .select("id, auth_user_id")
      .eq("id", data.id)
      .maybeSingle();
    if (fErr) throw new Error(fErr.message);
    if (!row) throw new Error("강사를 찾을 수 없습니다.");
    const { error } = await supabaseAdmin
      .from("instructors")
      .update({ email })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    // 이미 계정이 있으면 auth 이메일도 갱신
    if (row.auth_user_id) {
      await supabaseAdmin.auth.admin.updateUserById(row.auth_user_id, { email });
    }
    return { ok: true };
  });

// 강사 기수 저장 (instructors.cohorts — 다중 배정)
export const updateInstructorCohort = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        instructorId: z.string().uuid().optional(),
        authUserId: z.string().uuid().optional(),
        cohorts: z.array(z.string().trim().min(1).max(20)).max(50),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (!data.instructorId && !data.authUserId) throw new Error("대상 강사가 지정되지 않았습니다.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cohorts = Array.from(new Set(data.cohorts));
    let q = supabaseAdmin
      .from("instructors")
      .update({ cohorts, cohort: cohorts[0] ?? null } as any);
    q = data.instructorId ? q.eq("id", data.instructorId) : q.eq("auth_user_id", data.authUserId!);
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true, cohorts };
  });



// 로그인한 강사의 배정 기수 목록
export const getMyCohorts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("instructors")
      .select("cohort, cohorts")
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    const cohorts = Array.from(
      new Set([
        ...((((data as any)?.cohorts ?? []) as string[]).filter(Boolean)),
        ...((data as any)?.cohort ? [(data as any).cohort as string] : []),
      ]),
    );
    return { cohorts };
  });


// ============= 자체(로컬) 학생 등록 — 외부 DB와 연동되지 않는 학생 =============
// external_students.is_local = true 로 표시되며, 마스터 프로젝트 웹훅/백필의 영향을 받지 않습니다.
export const createLocalStudent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        name: z.string().trim().min(1).max(100),
        phone: z.string().trim().max(30).optional().default(""),
        parentPhone: z.string().trim().max(30).optional().default(""),
        branch: z.string().trim().max(50).optional().default(""),
        school: z.string().trim().max(100).optional().default(""),
        grade: z.string().trim().max(50).optional().default(""),
        classTime: z.string().trim().max(100).optional().default(""),
        tempPassword: z.string().trim().max(50).optional().default(""),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const digits = (v: string) => v.replace(/[^0-9]/g, "") || null;
    const phone = digits(data.phone);
    const parentPhone = digits(data.parentPhone);
    const loginPhone = phone ?? parentPhone;
    const tempPassword = data.tempPassword.trim() || null;

    if (!loginPhone && !tempPassword) {
      throw new Error("전화번호(본인 또는 학부모) 또는 임시 비밀번호 중 하나는 필요합니다.");
    }

    // 이름+전화번호 중복 방지 (로그인 식별자 충돌 방지)
    if (loginPhone) {
      const { data: dup } = await supabaseAdmin
        .from("external_students")
        .select("id")
        .eq("name", data.name)
        .or(`phone.eq.${loginPhone},parent_phone.eq.${loginPhone}`)
        .limit(1);
      if (dup && dup.length > 0) {
        throw new Error("동일한 이름/전화번호의 학생이 이미 등록되어 있습니다.");
      }
    }
    if (tempPassword) {
      const { data: dupTemp } = await supabaseAdmin
        .from("external_students")
        .select("id")
        .eq("name", data.name)
        .eq("temp_password", tempPassword)
        .limit(1);
      if (dupTemp && dupTemp.length > 0) {
        throw new Error("동일한 이름/임시 비밀번호가 이미 사용 중입니다.");
      }
    }

    const externalId = crypto.randomUUID();
    const localPart = loginPhone ?? externalId.replace(/-/g, "").slice(0, 12);
    const email = `local-${localPart}@mirror.local`;
    const password = tempPassword ?? loginPhone!.slice(-8);

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        name: data.name,
        phone,
        parent_phone: parentPhone,
        external_id: externalId,
        source: "local",
      },
    });
    if (createErr || !created?.user) {
      throw new Error(createErr?.message ?? "계정 생성에 실패했습니다.");
    }
    const authUserId = created.user.id;

    const { error: insErr } = await supabaseAdmin.from("external_students").insert({
      external_id: externalId,
      name: data.name,
      phone,
      parent_phone: parentPhone,
      school: data.school.trim() || null,
      grade: data.grade.trim() || null,
      class_time: data.classTime.trim() || null,
      enrollment_status: "재원",
      branch: data.branch.trim() || null,
      is_deleted: false,
      is_local: true,
      auth_user_id: authUserId,
      temp_password: tempPassword,
      synced_at: new Date().toISOString(),
    });
    if (insErr) {
      await supabaseAdmin.auth.admin.deleteUser(authUserId);
      throw new Error(insErr.message);
    }

    // 관리자가 직접 등록한 학생이므로 즉시 학생 권한 부여
    const { error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: authUserId, role: "student" });
    if (roleErr && !roleErr.message.includes("duplicate")) {
      throw new Error(roleErr.message);
    }

    if (tempPassword) {
      await supabaseAdmin.from("student_temp_password_history").insert({
        auth_user_id: authUserId,
        temp_password: tempPassword,
        issued_by: context.userId,
      });
    }

    return { ok: true, userId: authUserId, email, initialPassword: password };
  });
