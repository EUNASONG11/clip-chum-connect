import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { CANONICAL_BRANCHES, canonicalBranch, matchesBranch } from "@/lib/branch";
import { COHORT_OPTIONS } from "@/lib/cohort";

const VIMEO_API = "https://api.vimeo.com";

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("관리자만 접근할 수 있습니다.");
}

async function getStaffScope(context: { supabase: any; userId: string }) {
  const [{ data: admin }, { data: branchAdmin }] = await Promise.all([
    context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
    context.supabase.rpc("branch_admin_branch", { _uid: context.userId }),
  ]);
  if (admin) return { isAdmin: true as const, branch: null as string | null };
  const branch = (branchAdmin as string | null) ?? null;
  if (branch) return { isAdmin: false as const, branch };
  throw new Error("관리자 또는 교육원 관리자만 접근할 수 있습니다.");
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
  const { data: canAccess } = await context.supabase.rpc("instructor_can_access_class", {
    _uid: context.userId,
    _class_id: classId,
  });
  if (canAccess) return;
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
        week_label: z.string().regex(/^\d{4}-\d{2}-[1-5]$/).nullable().optional(),
        upload_started_at: z.string().datetime().nullable().optional(),
        upload_duration_ms: z.number().int().min(0).nullable().optional(),
        file_size_bytes: z.number().int().min(0).nullable().optional(),
        upload_stalled_ms: z.number().int().min(0).nullable().optional(),
        upload_retry_count: z.number().int().min(0).nullable().optional(),


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
        week_label: data.week_label ?? null,
        upload_started_at: data.upload_started_at ?? null,
        upload_duration_ms: data.upload_duration_ms ?? null,
        file_size_bytes: data.file_size_bytes ?? null,
        upload_stalled_ms: data.upload_stalled_ms ?? null,
        upload_retry_count: data.upload_retry_count ?? null,


      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    // 주차가 지정된 영상이면 해당 주차 외부 과제를 기본값으로 자동 생성/갱신
    try {
      const { autoPushWeekAssignment } = await import("./external-assignment-auto.server");
      await autoPushWeekAssignment({
        classId: data.class_id ?? null,
        weekLabel: data.week_label ?? null,
        userId: context.userId,
      });
    } catch (e) {
      console.error("[external-assignment] auto push error", e);
    }

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

// 5-2) 내 강사 프로필 (마이페이지)
export const getMyInstructorProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: inst } = await supabaseAdmin
      .from("instructors")
      .select("name, email, phone, branch, cohort, cohorts, all_branches")
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    if (!inst) return { instructor: null, classes: [] as { id: string; name: string }[] };

    const { data: links } = await supabaseAdmin
      .from("class_instructors")
      .select("class_id")
      .eq("instructor_user_id", context.userId)
      .is("deleted_at", null);
    const ids = Array.from(new Set((links ?? []).map((l: any) => l.class_id))).filter(Boolean);
    let classes: { id: string; name: string; branch: string | null }[] = [];
    if (ids.length) {
      const { data: cls } = await supabaseAdmin
        .from("classes")
        .select("id, name, branch")
        .in("id", ids)
        .is("deleted_at", null)
        .order("name");
      classes = (cls ?? []) as any;
    }
    const i = inst as any;
    const cohorts: string[] = Array.isArray(i.cohorts)
      ? i.cohorts.filter(Boolean)
      : i.cohort
      ? [String(i.cohort)]
      : [];
    return {
      instructor: {
        name: i.name ?? null,
        email: i.email ?? null,
        phone: i.phone ?? null,
        branch: i.branch ?? null,
        all_branches: Boolean(i.all_branches),
        cohorts,
      },
      classes,
    };
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

// 6-1) 로그인 사용자가 아무 역할도 없으면 자동으로 '학생' 역할 부여 (승인 대기 없음)
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
    let branch: string | null = null;
    {
      const { data: inst } = await supabaseAdmin
        .from("instructors")
        .select("branch")
        .eq("auth_user_id", context.userId)
        .maybeSingle();
      branch = (inst as any)?.branch ?? null;
    }

    return {
      isAdmin: roles.includes("admin"),
      isStudent: roles.includes("student"),
      isInstructor: roles.includes("instructor"),
      isBranchAdmin: roles.includes("branch_admin"),
      branch,
      isPending: !roles.includes("admin") && !roles.includes("student") && !roles.includes("instructor"),
    };
  });


// 6-2) 사용자 목록 (관리자 전용) — 수강반 수 포함
export const listUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const scope = await getStaffScope(context);
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
      orderBy: string[],
    ): Promise<T[]> => {
      const out: T[] = [];
      const size = 1000;
      let from = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data, error: e } = await retry(
          async () => {
            let q = supabaseAdmin.from(table).select(columns).is("deleted_at", null);
            for (const col of orderBy) q = q.order(col, { ascending: true });
            return await q.range(from, from + size - 1);
          },
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
      fetchAllRows<{ user_id: string; role: string }>("user_roles", "user_id, role", "user_roles", ["user_id", "role"]),
      fetchAllRows<{ user_id: string }>("class_students", "user_id", "class_students", ["class_id", "user_id"]),
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

    // 강사별 배정 수강반 이름 조회
    const { data: ciRows } = await retry(
      async () =>
        await supabaseAdmin
          .from("class_instructors")
          .select("instructor_user_id, classes(name)")
          .is("deleted_at", null),
      "class_instructors",
    );
    const classNamesMap = new Map<string, string[]>();
    (ciRows ?? []).forEach((r: any) => {
      const name = (r.classes as any)?.name as string | undefined;
      if (!r.instructor_user_id || !name) return;
      const list = classNamesMap.get(r.instructor_user_id) ?? [];
      if (!list.includes(name)) list.push(name);
      classNamesMap.set(r.instructor_user_id, list);
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
        const isBranchAdmin = roles.includes("branch_admin");
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
          isBranchAdmin,
          isPending,
          class_count: classCount.get(u.id) ?? 0,
          branch: inst?.branch ?? ext?.branch ?? null,
          cohort: inst?.cohort ?? null,
          cohorts: inst?.cohorts ?? [],
          class_names: classNamesMap.get(u.id) ?? [],
        };
      })
      .filter((u: any) => {
        // 교육원 관리자는 자기 교육원 소속만 조회
        if (scope.branch && !matchesBranch(scope.branch, u.branch)) return false;
        // 관리자·강사는 external_students 상태와 무관하게 항상 표시
        if (u.isAdmin || u.isInstructor) return true;
        const status = extMap.get(u.id)?.enrollment_status ?? null;
        // enrollment_status가 null이거나 '휴원'인 학생은 목록에서 제외
        if (!status) return false;
        if (status === "휴원") return false;
        return true;
      });
  });

// 6-2c) 학생 교육원 목록 (필터용)
export const listStudentBranches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const scope = await getStaffScope(context);
    if (scope.branch) return [canonicalBranch(scope.branch)];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("external_students")
      .select("branch")
      .eq("is_deleted", false)
      .not("branch", "is", null)
      .limit(10000);
    const set = new Set<string>();
    (data ?? []).forEach((r: any) => {
      const b = canonicalBranch(r.branch);
      if (b) set.add(b);
    });
    // 표준 교육원(상동·청라·송도) 우선 노출, 그 외 표기는 숨김
    return CANONICAL_BRANCHES.filter((b) => set.has(b));
  });

// 6-2b) 학생 목록 (서버 사이드 검색·페이지네이션) — external_students 기반이라 매우 빠름
export const listStudentUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        search: z.string().optional().default(""),
        branch: z.string().optional().default(""),
        page: z.number().int().min(1).optional().default(1),
        pageSize: z.number().int().min(1).max(500).optional().default(20),
        classFilter: z.enum(["all", "has_class", "no_class"]).optional().default("all"),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const scope = await getStaffScope(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const branch = scope.branch ?? (data.branch || "");
    const terms = data.search.trim().split(/\s+/).filter(Boolean).slice(0, 10);
    const classFilter = data.classFilter ?? "all";

    // 수강반 유무 필터용: 현재 조회 권한 내 수강반에 등록된 학생 id 집합
    let classUserIds: string[] | null = null;
    if (classFilter !== "all") {
      let csq = supabaseAdmin
        .from("class_students")
        .select("user_id, classes!inner(branch, deleted_at)")
        .is("deleted_at", null)
        .is("classes.deleted_at", null);
      if (scope.branch) {
        csq = csq.or(`classes.branch.eq.${scope.branch},classes.branch.is.null`);
      }
      const { data: cs } = await csq;
      classUserIds = Array.from(new Set((cs ?? []).map((r: any) => r.user_id as string)));
    }

    let q = supabaseAdmin
      .from("external_students")
      .select("auth_user_id, name, phone, parent_phone, branch, enrollment_status, created_at", { count: "exact" })
      .not("auth_user_id", "is", null)
      .eq("is_deleted", false)
      .not("enrollment_status", "is", null)
      .neq("enrollment_status", "휴원");

    if (branch) q = q.ilike("branch", `%${canonicalBranch(branch)}%`);

    if (classFilter === "has_class" && classUserIds) {
      const ids = classUserIds.length > 0 ? classUserIds : ["00000000-0000-0000-0000-000000000000"];
      q = q.in("auth_user_id", ids);
    } else if (classFilter === "no_class" && classUserIds) {
      const ids = classUserIds.length > 0 ? classUserIds : ["00000000-0000-0000-0000-000000000000"];
      q = q.not("auth_user_id", "in", ids);
    }

    if (terms.length > 0) {
      const orConditions = terms
        .map((t) => {
          const digits = t.replace(/[^0-9]/g, "");
          const isPhoneLike = digits.length >= 2 && digits.length === t.replace(/[-\s]/g, "").length;
          if (isPhoneLike) {
            return `phone.ilike.%${digits}%,parent_phone.ilike.%${digits}%`;
          }
          return `name.ilike.%${t}%`;
        })
        .join(",");
      q = q.or(orConditions);
    }

    const { data: rows, count, error } = await q.order("name", { ascending: true });
    if (error) throw new Error(error.message);

    // 정확히 일치하는 이름을 최상단에 배치한 뒤 나머지는 가나다순
    const lowerTerms = terms.map((t) => t.toLowerCase());
    const sortedRows = (rows ?? []).sort((a: any, b: any) => {
      const aName = (a.name ?? "").toLowerCase();
      const bName = (b.name ?? "").toLowerCase();
      const aExact = lowerTerms.some((t) => aName === t);
      const bExact = lowerTerms.some((t) => bName === t);
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;
      return aName.localeCompare(bName, "ko");
    });

    const from = (data.page - 1) * data.pageSize;
    const pagedRows = sortedRows.slice(from, from + data.pageSize);

    const ids = (rows ?? []).map((r: any) => r.auth_user_id as string);
    const [{ data: csRows }, { data: roleRows }] = await Promise.all([
      ids.length
        ? supabaseAdmin.from("class_students").select("user_id").in("user_id", ids).is("deleted_at", null)
        : Promise.resolve({ data: [] as any[] }),
      ids.length
        ? supabaseAdmin.from("user_roles").select("user_id, role").in("user_id", ids).is("deleted_at", null)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const classCount = new Map<string, number>();
    (csRows ?? []).forEach((r: any) => classCount.set(r.user_id, (classCount.get(r.user_id) ?? 0) + 1));
    const roleMap = new Map<string, string[]>();
    (roleRows ?? []).forEach((r: any) => {
      const list = roleMap.get(r.user_id) ?? [];
      list.push(r.role);
      roleMap.set(r.user_id, list);
    });

    const formatPhone = (p: string | null | undefined) => {
      if (!p) return "";
      const d = p.replace(/[^0-9]/g, "");
      if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
      if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
      return p;
    };

    return {
      total: count ?? 0,
      rows: (rows ?? []).map((r: any) => {
        const roles = roleMap.get(r.auth_user_id) ?? [];
        return {
          id: r.auth_user_id as string,
          email: "",
          nickname: r.name ?? "",
          phone: formatPhone(r.phone),
          rawPhone: (r.phone as string | null) ?? "",
          rawParentPhone: (r.parent_phone as string | null) ?? "",
          created_at: r.created_at ?? "",
          roles,
          isAdmin: roles.includes("admin"),
          isStudent: true,
          isInstructor: roles.includes("instructor"),
          isBranchAdmin: roles.includes("branch_admin"),
          isPending: false,
          class_count: classCount.get(r.auth_user_id) ?? 0,
          branch: r.branch ?? null,
          cohort: null,
          cohorts: [],
        };
      }),
    };
  });

// 6-2d) 특정 학생 1명의 수강반 + 영상별 학습 이력 (펼칠 때만 조회)
export const getStudentLearningDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const scope = await getStaffScope(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: enrolls, error: eErr } = await supabaseAdmin
      .from("class_students")
      .select("class_id, created_at, classes!inner(id, name, branch, deleted_at)")
      .eq("user_id", data.userId)
      .is("deleted_at", null);
    if (eErr) throw new Error(eErr.message);

    const rows = (enrolls ?? []).filter((r: any) => {
      const c = r.classes;
      if (!c || c.deleted_at) return false;
      if (scope.branch && c.branch && c.branch !== scope.branch) return false;
      return true;
    });
    if (rows.length === 0) return { classes: [] as any[] };

    const classIds = rows.map((r: any) => r.class_id as string);

    const [{ data: videos, error: vErr }, { data: progress, error: pErr }] = await Promise.all([
      supabaseAdmin
        .from("videos")
        .select("id, title, class_id, duration, created_at, week_label")
        .in("class_id", classIds)
        .is("deleted_at", null)
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("video_progress")
        .select("video_id, watched_ratio, is_completed, completed_at, watched_seconds, seek_attempts, updated_at")
        .eq("user_id", data.userId),
    ]);
    if (vErr) throw new Error(vErr.message);
    if (pErr) throw new Error(pErr.message);

    const pMap = new Map<string, any>();
    (progress ?? []).forEach((p: any) => pMap.set(p.video_id, p));

    return {
      classes: rows
        .map((r: any) => {
          const vids = (videos ?? []).filter((v: any) => v.class_id === r.class_id);
          const items = vids.map((v: any) => {
            const p = pMap.get(v.id);
            return {
              videoId: v.id as string,
              title: (v.title ?? "") as string,
              weekLabel: (v.week_label ?? null) as string | null,
              duration: (v.duration ?? null) as number | null,
              createdAt: (v.created_at ?? "") as string,
              watchedRatio: Number(p?.watched_ratio ?? 0),
              watchedSeconds: Number(p?.watched_seconds ?? 0),
              seekAttempts: Number(p?.seek_attempts ?? 0),
              isCompleted: !!p?.is_completed,
              completedAt: (p?.completed_at ?? null) as string | null,
              updatedAt: (p?.updated_at ?? null) as string | null,
            };
          });
          const completed = items.filter((i) => i.isCompleted).length;
          const avgRatio =
            items.length > 0 ? items.reduce((s, i) => s + i.watchedRatio, 0) / items.length : 0;
          return {
            classId: r.class_id as string,
            className: (r.classes?.name ?? "") as string,
            branch: (r.classes?.branch ?? null) as string | null,
            enrolledAt: (r.created_at ?? "") as string,
            videoTotal: items.length,
            completed,
            avgRatio,
            videos: items,
          };
        })
        .sort((a, b) => a.className.localeCompare(b.className, "ko")),
    };
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

// 6-4b) 강사 ↔ 중간 관리자(교육원 관리자) 승격/해제
export const setBranchAdminRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ userId: z.string().uuid(), enabled: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.userId === context.userId) {
      throw new Error("자기 자신의 권한은 변경할 수 없습니다.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // 중복(soft delete 포함) 방지를 위해 기존 행 제거 후 필요 시 재삽입
    const { error: delErr } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", data.userId)
      .eq("role", "branch_admin");
    if (delErr) throw new Error(delErr.message);
    if (data.enabled) {
      const { error: insErr } = await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: data.userId, role: "branch_admin" });
      if (insErr) throw new Error(insErr.message);
      // 중간 관리자 승격 시 전 기수 접근 권한 자동 부여
      const { error: cohErr } = await supabaseAdmin
        .from("instructors")
        .update({ cohorts: COHORT_OPTIONS, cohort: COHORT_OPTIONS[0] } as any)
        .eq("auth_user_id", data.userId);
      if (cohErr) throw new Error(cohErr.message);
    }
    return { ok: true, enabled: data.enabled };
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
    // 대상 역할 부여 (중복은 무시)

    const rows = data.userIds.map((user_id) => ({ user_id, role: data.role }));
    const { error } = await supabaseAdmin
      .from("user_roles")
      .upsert(rows, { onConflict: "user_id,role", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    return { ok: true, count: data.userIds.length };
  });

// 6-5c) (제거) 승인 대기 제도 폐지로 되돌리기 기능 없음


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
        week_label: z.string().regex(/^\d{4}-\d{2}-[1-5]$/).nullable().optional(),


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
        week_label: data.week_label ?? null,


      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    try {
      const { autoPushWeekAssignment } = await import("./external-assignment-auto.server");
      await autoPushWeekAssignment({
        classId: data.class_id ?? null,
        weekLabel: data.week_label ?? null,
        userId: context.userId,
      });
    } catch (e) {
      console.error("[external-assignment] auto push error", e);
    }

    return row;
  });


// 이메일 존재 여부 확인 (로그인 오류 시 원인 판별용)
export const checkEmailExists = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ email: z.string().email() }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const target = data.email.trim().toLowerCase();

    // 관리자·강사 탭 전용 확인: 학생 계정(수천 개)은 전화번호 로그인을 쓰므로
    // 강사 명부 + 관리자 권한 보유자만 조회해 빠르게 판별한다.
    // 1) 강사 명부에서 확인
    const { data: rows } = await supabaseAdmin
      .from("instructors")
      .select("id")
      .ilike("email", target)
      .limit(1);
    if (rows && rows.length > 0) return { exists: true, certain: true };

    // 2) 관리자/강사 권한 보유 계정만 확인 (소수)
    const { data: roleRows, error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .in("role", ["admin", "branch_admin", "instructor"])
      .is("deleted_at", null);
    if (roleErr) throw new Error(roleErr.message);
    for (const r of roleRows ?? []) {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(r.user_id);
      if ((u.user?.email ?? "").toLowerCase() === target) {
        return { exists: true, certain: true };
      }
    }
    return { exists: false, certain: true };
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
      .select("name, phone, parent_phone, auth_user_id, is_deleted, enrollment_status, cohort, synced_at")
      .eq("name", name)
      .or(`phone.eq.${phoneDigits},parent_phone.eq.${phoneDigits}`)
      .limit(5);
    if (error) throw new Error(error.message);

    let active = (rows ?? []).filter((r) => !r.is_deleted && r.auth_user_id);
    if (active.length > 1) {
      // 동일 이름/번호가 여러 건 미러링된 경우: 실제 사용 계정을 자동으로 특정한다.
      // 1) 학생 본인 전화번호가 일치하는 행 2) 재원 상태 3) 기수 정보 보유 4) 수강반 배정/학습 기록 보유
      const own = active.filter((r) => (r.phone ?? "") === phoneDigits);
      if (own.length) active = own;
      if (active.length > 1) {
        const enrolled = active.filter((r) => r.enrollment_status === "재원");
        if (enrolled.length) active = enrolled;
      }
      if (active.length > 1) {
        const withCohort = active.filter((r) => !!r.cohort);
        if (withCohort.length) active = withCohort;
      }
      if (active.length > 1) {
        const ids = active.map((r) => r.auth_user_id!) as string[];
        const [{ data: cs }, { data: vp }] = await Promise.all([
          supabaseAdmin.from("class_students").select("user_id").in("user_id", ids).is("deleted_at", null),
          supabaseAdmin.from("video_progress").select("user_id").in("user_id", ids),
        ]);
        const used = new Set([...(cs ?? []), ...(vp ?? [])].map((r) => r.user_id));
        const withUsage = active.filter((r) => used.has(r.auth_user_id!));
        if (withUsage.length) active = withUsage;
      }
    }
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
      // 비밀번호 재설정(비용이 큰 Auth 쓰기)은 하지 않는다.
      // 로그인이 실패한 경우에만 syncStudentPassword로 1회 동기화한다.
      return {
        email: userRes.user.email,
        initialPassword: phoneDigits.slice(-8),
      };
    }

    throw new Error("이름 또는 전화번호가 일치하는 계정을 찾을 수 없습니다.");
  });

// 학생 로그인 실패 시에만 호출: 입력한 전화번호 뒷 8자리로 비밀번호를 재동기화
export const syncStudentPassword = createServerFn({ method: "POST" })
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
    const name = data.name.trim();
    const phoneDigits = data.phone.replace(/[^0-9]/g, "");
    if (phoneDigits.length < 8) throw new Error("전화번호가 올바르지 않습니다.");

    const { data: rows, error } = await supabaseAdmin
      .from("external_students")
      .select("auth_user_id, is_deleted, phone, enrollment_status, cohort")
      .eq("name", name)
      .or(`phone.eq.${phoneDigits},parent_phone.eq.${phoneDigits}`)
      .limit(5);
    if (error) throw new Error(error.message);
    let active = (rows ?? []).filter((r) => !r.is_deleted && r.auth_user_id);
    if (active.length > 1) {
      const own = active.filter((r) => (r.phone ?? "") === phoneDigits);
      if (own.length) active = own;
      if (active.length > 1) {
        const enrolled = active.filter((r) => r.enrollment_status === "재원");
        if (enrolled.length) active = enrolled;
      }
      if (active.length > 1) {
        const withCohort = active.filter((r) => !!r.cohort);
        if (withCohort.length) active = withCohort;
      }
    }
    if (active.length !== 1) throw new Error("계정을 특정할 수 없습니다. 관리자에게 문의하세요.");

    const password = phoneDigits.slice(-8);
    const { error: upErr } = await supabaseAdmin.auth.admin.updateUserById(
      active[0].auth_user_id!,
      { password },
    );
    if (upErr) throw new Error(upErr.message);
    return { password };
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

export const resetInstructorPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ instructorId: z.string().uuid() }).parse(i))
  .handler(async ({ context, data }) => {
    const scope = await getStaffScope(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: inst, error } = await supabaseAdmin
      .from("instructors")
      .select("id, name, auth_user_id, branch")
      .eq("id", data.instructorId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!inst?.auth_user_id) throw new Error("계정이 없는 강사입니다.");
    if (!scope.isAdmin) {
      if (!scope.branch || !matchesBranch(inst.branch, scope.branch)) {
        throw new Error("담당 교육원 소속 강사만 초기화할 수 있습니다.");
      }
    }

    const { error: uErr } = await supabaseAdmin.auth.admin.updateUserById(inst.auth_user_id, {
      password: "12345678",
    });
    if (uErr) throw new Error(uErr.message);

    const { error: iErr } = await supabaseAdmin
      .from("instructors")
      .update({ must_change_password: true })
      .eq("id", inst.id);
    if (iErr) throw new Error(iErr.message);

    return { ok: true, tempPassword: "12345678" };
  });



// ============= 강사 명부(로스터) 관리 =============

export const listInstructorRoster = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const scope = await getStaffScope(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("instructors")
      .select("id, name, email, phone, branch, cohort, cohorts, auth_user_id, must_change_password")
      .order("name", { ascending: true });
    if (scope.branch) q = q.ilike("branch", `%${canonicalBranch(scope.branch)}%`);
    const { data, error } = await q;
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
      return {
        ok: false as const,
        error: "전화번호(본인 또는 학부모) 또는 임시 비밀번호 중 하나는 필요합니다.",
      };
    }

    // 이름+전화번호 중복 방지 (로그인 식별자 충돌 방지)
    if (loginPhone) {
      const { data: dup } = await supabaseAdmin
        .from("external_students")
        .select("id")
        .eq("name", data.name)
        .eq("is_deleted", false)
        .or(`phone.eq.${loginPhone},parent_phone.eq.${loginPhone}`)
        .limit(1);
      if (dup && dup.length > 0) {
        return {
          ok: false as const,
          error: "동일한 이름과 전화번호로 등록된 활성 학생이 이미 있습니다.",
        };
      }
    }
    if (tempPassword) {
      const { data: dupTemp } = await supabaseAdmin
        .from("external_students")
        .select("id")
        .eq("name", data.name)
        .eq("is_deleted", false)
        .eq("temp_password", tempPassword)
        .limit(1);
      if (dupTemp && dupTemp.length > 0) {
        return {
          ok: false as const,
          error: "동일한 이름과 임시 비밀번호가 이미 사용 중입니다.",
        };
      }
    }

    const externalId = crypto.randomUUID();
    const localPart = loginPhone ?? externalId.replace(/-/g, "").slice(0, 12);
    const email = `local-${localPart}@mirror.local`;
    const password = tempPassword ?? loginPhone?.slice(-8);
    if (!password) {
      return { ok: false as const, error: "초기 비밀번호를 생성할 수 없습니다." };
    }

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

    return { ok: true as const, userId: authUserId, email, initialPassword: password };
  });


// ============= 자체(로컬) 강사 등록 =============
// instructors 테이블에 직접 추가하고 이메일 기반 계정을 즉시 생성합니다.
export const createLocalInstructor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        name: z.string().trim().min(1).max(100),
        email: z.string().trim().email().max(255),
        phone: z.string().trim().max(30).optional().default(""),
        branch: z.string().trim().max(50).optional().default(""),
        cohorts: z.array(z.string().trim().min(1).max(20)).max(50).optional().default([]),
        tempPassword: z.string().trim().max(50).optional().default(""),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const email = data.email.toLowerCase();
    const phone = data.phone.replace(/[^0-9]/g, "") || null;
    const password = data.tempPassword.trim() || "12345678";
    const cohorts = Array.from(new Set(data.cohorts.filter(Boolean)));

    const { data: dup } = await supabaseAdmin
      .from("instructors")
      .select("id")
      .eq("email", email)
      .limit(1);
    if (dup && dup.length > 0) {
      return { ok: false as const, error: "동일한 이메일로 등록된 강사가 이미 있습니다." };
    }

    let authUserId: string | null = null;
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: data.name, source: "instructor-local" },
    });
    if (createErr) {
      const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const found = list?.users.find((u) => (u.email ?? "").toLowerCase() === email);
      if (!found) {
        return { ok: false as const, error: createErr.message };
      }
      authUserId = found.id;
    } else {
      authUserId = created?.user?.id ?? null;
    }
    if (!authUserId) return { ok: false as const, error: "계정 생성에 실패했습니다." };

    const { error: insErr } = await supabaseAdmin.from("instructors").insert({
      name: data.name,
      email,
      phone,
      branch: data.branch.trim() || null,
      cohorts,
      cohort: cohorts[0] ?? null,
      auth_user_id: authUserId,
      must_change_password: true,
    } as any);
    if (insErr) return { ok: false as const, error: insErr.message };

    const { error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: authUserId, role: "instructor" }, { onConflict: "user_id,role" });
    if (roleErr) return { ok: false as const, error: roleErr.message };

    return { ok: true as const, userId: authUserId, email, initialPassword: password };
  });

// ============= 학생 전화번호 수정 (로그인과 연결) =============
// 관리자 또는 교육원 관리자(본인 담당 교육원 학생만)가 수정할 수 있습니다.
// 학생 로그인은 이름 + 전화번호(본인/학부모)이며 비밀번호는 전화번호 뒤 8자리이므로,
// 번호 변경 시 Auth 비밀번호도 함께 동기화합니다.
export const updateStudentPhone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        authUserId: z.string().uuid(),
        phone: z.string().trim().max(30).optional().default(""),
        parentPhone: z.string().trim().max(30).optional().default(""),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const scope = await getStaffScope(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const digits = (v: string) => v.replace(/[^0-9]/g, "") || null;
    const phone = digits(data.phone);
    const parentPhone = digits(data.parentPhone);
    const loginPhone = phone ?? parentPhone;

    const { data: student, error: sErr } = await supabaseAdmin
      .from("external_students")
      .select("id, name, branch, temp_password, is_deleted")
      .eq("auth_user_id", data.authUserId)
      .eq("is_deleted", false)
      .maybeSingle();
    if (sErr) throw new Error(sErr.message);
    if (!student) return { ok: false as const, error: "학생 정보를 찾을 수 없습니다." };

    if (!scope.isAdmin && student.branch !== scope.branch) {
      return { ok: false as const, error: "담당 교육원 학생만 수정할 수 있습니다." };
    }

    if (!loginPhone && !student.temp_password) {
      return {
        ok: false as const,
        error: "전화번호(본인 또는 학부모)를 최소 하나는 입력해야 합니다.",
      };
    }

    if (loginPhone) {
      const { data: dup } = await supabaseAdmin
        .from("external_students")
        .select("id")
        .eq("name", student.name)
        .eq("is_deleted", false)
        .neq("id", student.id)
        .or(`phone.eq.${loginPhone},parent_phone.eq.${loginPhone}`)
        .limit(1);
      if (dup && dup.length > 0) {
        return {
          ok: false as const,
          error: "동일한 이름과 전화번호의 학생이 이미 있어 로그인이 충돌합니다.",
        };
      }
    }

    const { error: upErr } = await supabaseAdmin
      .from("external_students")
      .update({ phone, parent_phone: parentPhone })
      .eq("id", student.id);
    if (upErr) throw new Error(upErr.message);

    let newPassword: string | null = null;
    if (loginPhone && loginPhone.length >= 8) {
      newPassword = loginPhone.slice(-8);
      const { error: pwErr } = await supabaseAdmin.auth.admin.updateUserById(data.authUserId, {
        password: newPassword,
      });
      if (pwErr) throw new Error(pwErr.message);
    }

    return { ok: true as const, phone, parentPhone, newPassword };
  });
