import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { assertExternalAssignmentStaff } from "./external-assignment-auth.server";

/** 연동 설정 여부 + 수강반별 내보낸 과제 목록 */
export const getExternalAssignmentStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ classId: z.string().uuid().optional() }).parse(i ?? {}))
  .handler(async ({ data, context }) => {
    await assertExternalAssignmentStaff(context as any);

    const configured =
      !!process.env["EXTERNAL_ASSIGNMENT_BASE_URL"] && !!process.env["EXTERNAL_SYNC_API_KEY"];

    let query = context.supabase
      .from("external_assignment_links")
      .select("id, external_id, assignment_type, scope, period_start, period_end, remote_assignment_type_id, student_count, last_synced_at, last_error, sync_status, needs_resync, class_id, video_id, week_label, created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(50);
    if (data.classId) query = query.eq("class_id", data.classId);

    const { data: links, error } = await query;
    if (error) throw new Error(error.message);

    const linkList = links ?? [];
    const linkIds = linkList.map((l: any) => l.id as string);

    // 링크별 완료 통보 집계 (학생 단위 중복 제거)
    type Person = { user_id: string; name: string; status: string; occurred_at: string | null };
    const statsByLink: Record<
      string,
      { completedCount: number; statusCounts: Record<string, number>; people: Person[] }
    > = {};

    if (linkIds.length > 0) {
      const { data: comps, error: compErr } = await context.supabase
        .from("external_assignment_completions")
        .select("link_id, user_id, status, remote_status, occurred_at")
        .in("link_id", linkIds)
        .order("occurred_at", { ascending: false });
      if (compErr) throw new Error(compErr.message);

      const rows = comps ?? [];
      const userIds = Array.from(new Set(rows.map((c: any) => c.user_id as string)));
      const nameById = new Map<string, string>();
      if (userIds.length > 0) {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: students } = await supabaseAdmin
          .from("external_students")
          .select("auth_user_id, name")
          .in("auth_user_id", userIds);
        for (const s of students ?? []) {
          if (s.auth_user_id) nameById.set(s.auth_user_id, s.name);
        }
      }

      const seen = new Set<string>();
      for (const c of rows) {
        const key = `${c.link_id}:${c.user_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const s = (statsByLink[c.link_id] ??= {
          completedCount: 0,
          statusCounts: {},
          people: [],
        });
        const label = (c.remote_status || c.status || "unknown") as string;
        s.statusCounts[label] = (s.statusCounts[label] ?? 0) + 1;
        s.completedCount += 1;
        s.people.push({
          user_id: c.user_id,
          name: nameById.get(c.user_id) ?? "이름 미확인",
          status: label,
          occurred_at: c.occurred_at ?? null,
        });
      }
    }

    // 영상별 과제인 경우 영상 제목 표시
    const videoIds = Array.from(
      new Set(linkList.map((l: any) => l.video_id as string | null).filter((v): v is string => !!v)),
    );
    const videoTitleById = new Map<string, string>();
    if (videoIds.length > 0) {
      const { data: vids } = await context.supabase
        .from("videos")
        .select("id, title")
        .in("id", videoIds);
      for (const v of vids ?? []) videoTitleById.set(v.id, v.title);
    }

    const enriched = linkList.map((l: any) => {
      const s = statsByLink[l.id] ?? { completedCount: 0, statusCounts: {}, people: [] };
      const target = l.student_count ?? 0;
      const statusCounts = { ...s.statusCounts };
      const initial = Math.max(0, target - s.completedCount);
      if (initial > 0) statusCounts["initial"] = (statusCounts["initial"] ?? 0) + initial;
      return {
        ...l,
        video_title: l.video_id ? (videoTitleById.get(l.video_id) ?? null) : null,
        completed_count: s.completedCount,
        target_count: target,
        status_counts: statusCounts,
        completed_students: s.people,
      };
    });

    return { configured, links: enriched };
  });

/** 수강반 영상 목록 (외부 과제 내보내기 대상 선택용) */
export const listClassVideosForAssignment = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ classId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertExternalAssignmentStaff(context as any);
    const { data: videos, error } = await context.supabase
      .from("videos")
      .select("id, title, sort_order, created_at")
      .eq("class_id", data.classId)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return videos ?? [];
  });

/** 선택한 영상별로 외부 "과제 점검"에 과제를 각각 생성 */
export const pushVideoAssignmentsToExternal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        classId: z.string().uuid(),
        videoIds: z.array(z.string().uuid()).min(1).max(50),
        periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        titlePrefix: z.string().trim().max(100).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertExternalAssignmentStaff(context as any);

    const { data: klass, error: classErr } = await context.supabase
      .from("classes")
      .select("id, name")
      .eq("id", data.classId)
      .is("deleted_at", null)
      .maybeSingle();
    if (classErr) throw new Error(classErr.message);
    if (!klass) throw new Error("수강반을 찾을 수 없거나 권한이 없습니다.");

    const { data: videos, error: vidErr } = await context.supabase
      .from("videos")
      .select("id, title")
      .eq("class_id", data.classId)
      .in("id", data.videoIds)
      .is("deleted_at", null);
    if (vidErr) throw new Error(vidErr.message);
    if (!videos || videos.length === 0) throw new Error("선택한 영상을 찾을 수 없습니다.");

    const { data: enrolled, error: enrollErr } = await context.supabase
      .from("class_students")
      .select("user_id")
      .eq("class_id", data.classId)
      .is("deleted_at", null);
    if (enrollErr) throw new Error(enrollErr.message);
    const userIds = (enrolled ?? []).map((r: any) => r.user_id as string);
    if (userIds.length === 0) throw new Error("이 수강반에 배정된 학생이 없습니다.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: students } = await supabaseAdmin
      .from("external_students")
      .select("external_id, auth_user_id")
      .in("auth_user_id", userIds)
      .eq("is_deleted", false);

    const externalStudentIds = Array.from(
      new Set((students ?? []).map((s) => s.external_id).filter((v): v is string => !!v)),
    );
    if (externalStudentIds.length === 0) {
      throw new Error("외부 시스템에서 식별 가능한 학생이 없습니다. (학생 명부 동기화 필요)");
    }

    const { pushAssignmentSync } = await import("./external-assignment.server");
    const prefix = data.titlePrefix?.trim() || klass.name;

    const results: { videoId: string; title: string; ok: boolean; error?: string }[] = [];

    for (const v of videos) {
      const externalId = `class-${data.classId}-video-${v.id}`;
      const assignmentType = `${prefix} - ${v.title}`.slice(0, 200);

      let remoteAssignmentTypeId: string | null = null;
      let lastError: string | null = null;
      try {
        const res = await pushAssignmentSync({
          external_id: externalId,
          assignment_type: assignmentType,
          scope: "individual",
          target: { class_name: klass.name, video_title: v.title },
          period: { start: data.periodStart, end: data.periodEnd },
          students: externalStudentIds,
        });
        remoteAssignmentTypeId = res.remoteAssignmentTypeId;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }

      const { error: upsertErr } = await supabaseAdmin
        .from("external_assignment_links")
        .upsert(
          {
            source: "elearning",
            external_id: externalId,
            class_id: data.classId,
            video_id: v.id,
            assignment_type: assignmentType,
            scope: "individual",
            period_start: data.periodStart,
            period_end: data.periodEnd,
            remote_assignment_type_id: remoteAssignmentTypeId,
            student_count: externalStudentIds.length,
            last_synced_at: lastError ? null : new Date().toISOString(),
            last_error: lastError,
            created_by: context.userId,
            deleted_at: null,
            deleted_by: null,
          },
          { onConflict: "source,external_id" },
        );
      if (upsertErr) throw new Error(upsertErr.message);

      results.push({
        videoId: v.id,
        title: v.title,
        ok: !lastError,
        ...(lastError ? { error: lastError } : {}),
      });
    }

    return {
      ok: results.every((r) => r.ok),
      studentCount: externalStudentIds.length,
      skipped: userIds.length - externalStudentIds.length,
      results,
    };
  });

/** 수강반 학생 전체를 외부 "과제 점검"에 과제로 등록 (수동 버튼) */
export const pushClassAssignmentToExternal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        classId: z.string().uuid(),
        assignmentType: z.string().trim().min(1).max(200),
        periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        externalId: z.string().trim().min(1).max(120).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertExternalAssignmentStaff(context as any);

    if (data.assignmentType === "이러닝 영상 시청") {
      throw new Error("'이러닝 영상 시청' 과제는 외부로 내보낼 수 없습니다.");
    }

    // 수강반 확인 (RLS로 접근 권한 검증됨)
    const { data: klass, error: classErr } = await context.supabase
      .from("classes")
      .select("id, name")
      .eq("id", data.classId)
      .is("deleted_at", null)
      .maybeSingle();
    if (classErr) throw new Error(classErr.message);
    if (!klass) throw new Error("수강반을 찾을 수 없거나 권한이 없습니다.");

    // 배정된 학생 → 외부 식별자(마스터 students.id)로 변환
    const { data: enrolled, error: enrollErr } = await context.supabase
      .from("class_students")
      .select("user_id")
      .eq("class_id", data.classId)
      .is("deleted_at", null);
    if (enrollErr) throw new Error(enrollErr.message);

    const userIds = (enrolled ?? []).map((r: any) => r.user_id as string);
    if (userIds.length === 0) throw new Error("이 수강반에 배정된 학생이 없습니다.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: students } = await supabaseAdmin
      .from("external_students")
      .select("external_id, auth_user_id")
      .in("auth_user_id", userIds)
      .eq("is_deleted", false);

    const externalStudentIds = Array.from(
      new Set(
        (students ?? [])
          .map((s) => s.external_id)
          .filter((v): v is string => !!v),
      ),
    );
    if (externalStudentIds.length === 0) {
      throw new Error("외부 시스템에서 식별 가능한 학생이 없습니다. (학생 명부 동기화 필요)");
    }

    // 외부 과제 정의는 수강반당 1건만 유지한다. 이미 내보낸 활성 링크가 있으면
    // 기간이 바뀌어도 같은 외부 고유키를 재사용하여 외부 DB에서 upsert되도록 한다.
    const { data: existingLink } = await supabaseAdmin
      .from("external_assignment_links")
      .select("external_id")
      .eq("class_id", data.classId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const externalId =
      data.externalId ?? existingLink?.external_id ?? `class-${data.classId}`;

    const { pushAssignmentSync } = await import("./external-assignment.server");

    let remoteAssignmentTypeId: string | null = null;
    let lastError: string | null = null;
    try {
      const res = await pushAssignmentSync({
        external_id: externalId,
        assignment_type: data.assignmentType,
        scope: "individual",
        target: { class_name: klass.name },
        period: { start: data.periodStart, end: data.periodEnd },
        students: externalStudentIds,
      });
      remoteAssignmentTypeId = res.remoteAssignmentTypeId;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }

    const { error: upsertErr } = await supabaseAdmin
      .from("external_assignment_links")
      .upsert(
        {
          source: "elearning",
          external_id: externalId,
          class_id: data.classId,
          assignment_type: data.assignmentType,
          scope: "individual",
          period_start: data.periodStart,
          period_end: data.periodEnd,
          remote_assignment_type_id: remoteAssignmentTypeId,
          student_count: externalStudentIds.length,
          last_synced_at: lastError ? null : new Date().toISOString(),
          last_error: lastError,
          created_by: context.userId,
        },
        { onConflict: "source,external_id" },
      );
    if (upsertErr) throw new Error(upsertErr.message);

    if (lastError) throw new Error(lastError);

    return {
      ok: true,
      externalId,
      studentCount: externalStudentIds.length,
      skipped: userIds.length - externalStudentIds.length,
    };
  });

/** 재통보 대상 학생 목록 (완료 영상 수 + 최근 전송 상태) */
export const listResyncTargets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        classId: z.string().uuid(),
        weekLabel: z.string().regex(/^\d{4}-\d{2}-[1-5]$/).optional(),
        weekLabels: z
          .array(z.string().regex(/^\d{4}-\d{2}-[1-5]$/))
          .min(1)
          .max(20)
          .optional(),
        /** 특정 교육원 학생만 볼 때 사용 (없으면 전체) */
        branch: z.string().trim().min(1).nullish(),
      })
      .refine((v) => !!v.weekLabel || (v.weekLabels && v.weekLabels.length > 0), {
        message: "주차를 1개 이상 선택해 주세요.",
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertExternalAssignmentStaff(context as any);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const weekLabels = Array.from(
      new Set([...(data.weekLabels ?? []), ...(data.weekLabel ? [data.weekLabel] : [])]),
    );

    const { data: videos } = await supabaseAdmin
      .from("videos")
      .select("id")
      .eq("class_id", data.classId)
      .in("week_label", weekLabels)
      .eq("is_published", true)
      .is("deleted_at", null);
    const videoIds = (videos ?? []).map((v) => v.id as string);
    if (videoIds.length === 0) return [] as any[];

    const { data: rows } = await supabaseAdmin
      .from("video_progress")
      .select("user_id, video_id, completed_at, updated_at")
      .in("video_id", videoIds)
      .eq("is_completed", true);


    const byUser = new Map<string, { completed: number; last: string | null }>();
    for (const r of rows ?? []) {
      const u = r.user_id as string;
      const cur = byUser.get(u) ?? { completed: 0, last: null };
      cur.completed += 1;
      const at = (r.completed_at ?? r.updated_at) as string | null;
      if (at && (!cur.last || at > cur.last)) cur.last = at;
      byUser.set(u, cur);
    }
    const userIds = Array.from(byUser.keys());
    if (userIds.length === 0) return [] as any[];

    const { data: students } = await supabaseAdmin
      .from("external_students")
      .select("auth_user_id, name, external_id, branch")
      .in("auth_user_id", userIds);
    const nameById = new Map<
      string,
      { name: string; identified: boolean; branch: string | null }
    >();
    for (const s of students ?? []) {
      if (!s.auth_user_id) continue;
      const sBranch = (s.branch as string | null) ?? null;
      if (data.branch) {
        const match = data.branch === "미지정" ? !sBranch : sBranch === data.branch;
        if (!match) continue;
      }
      nameById.set(s.auth_user_id, {
        name: s.name,
        identified: !!s.external_id,
        branch: sBranch,
      });
    }

    // 교육원 필터가 있으면 해당 교육원 학생만 남긴다
    const filteredUserIds = data.branch ? userIds.filter((u) => nameById.has(u)) : userIds;
    if (filteredUserIds.length === 0) return [] as any[];

    // 최근 전송 상태 (해당 수강반 링크 기준)
    const { data: links } = await supabaseAdmin
      .from("external_assignment_links")
      .select("id")
      .eq("class_id", data.classId)
      .in("week_label", weekLabels)
      .is("deleted_at", null);

    const linkIds = (links ?? []).map((l) => l.id as string);
    const statusByUser = new Map<string, { status: string; error: string | null }>();
    if (linkIds.length > 0) {
      const { data: comps } = await supabaseAdmin
        .from("external_assignment_completions")
        .select("user_id, status, remote_status, error_message, updated_at")
        .in("link_id", linkIds)
        .order("updated_at", { ascending: false });
      for (const c of comps ?? []) {
        const u = c.user_id as string;
        if (statusByUser.has(u)) continue;
        statusByUser.set(u, {
          status: (c.remote_status || c.status || "unknown") as string,
          error: (c.error_message as string | null) ?? null,
        });
      }
    }

    return filteredUserIds
      .map((u) => {
        const info = nameById.get(u);
        const st = statusByUser.get(u);
        return {
          user_id: u,
          name: info?.name ?? "이름 미확인",
          branch: info?.branch ?? null,
          identified: info?.identified ?? false,

          completed_videos: byUser.get(u)?.completed ?? 0,
          last_completed_at: byUser.get(u)?.last ?? null,
          status: st?.status ?? "not_sent",
          error_message: st?.error ?? null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  });

/** 이미 완료된 시청 기록을 외부 "과제 점검"에 재통보 (누락분 보정, 학생 선택 가능) */
export const resyncCompletionsToExternal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        classId: z.string().uuid(),
        weekLabel: z.string().regex(/^\d{4}-\d{2}-[1-5]$/),
        userIds: z.array(z.string().uuid()).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertExternalAssignmentStaff(context as any);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resyncWeekCompletions } = await import("./external-assignment-resync.server");

    const { data: weekLink, error: linkErr } = await supabaseAdmin
      .from("external_assignment_links")
      .select("id")
      .eq("class_id", data.classId)
      .eq("week_label", data.weekLabel)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    if (linkErr) throw new Error(linkErr.message);
    if (!weekLink) {
      throw new Error("선택한 주차 과제가 아직 없습니다. 먼저 '선택 주차 내보내기'를 실행해 주세요.");
    }

    return await resyncWeekCompletions({
      classId: data.classId,
      weekLabel: data.weekLabel,
      ...(data.userIds && data.userIds.length > 0 ? { userIds: data.userIds } : {}),
    });
  });


/** 수강반 영상을 주차별로 묶어 반환 (연동 현황 포함) */
export const listClassWeeksForAssignment = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ classId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertExternalAssignmentStaff(context as any);

    const { data: videos, error } = await context.supabase
      .from("videos")
      .select("id, title, week_label, sort_order, created_at")
      .eq("class_id", data.classId)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    const { data: links, error: linkErr } = await context.supabase
      .from("external_assignment_links")
      .select("id, week_label, assignment_type, period_start, period_end, last_error, last_synced_at")
      .eq("class_id", data.classId)
      .not("week_label", "is", null)
      .is("deleted_at", null);
    if (linkErr) throw new Error(linkErr.message);

    const linkByWeek = new Map<string, any>();
    for (const l of links ?? []) if (l.week_label) linkByWeek.set(l.week_label as string, l);

    type WeekBucket = { week_label: string | null; videos: { id: string; title: string }[] };
    const byWeek = new Map<string, WeekBucket>();
    for (const v of (videos ?? []) as any[]) {
      const key = (v.week_label as string | null) ?? "";
      const bucket: WeekBucket =
        byWeek.get(key) ?? { week_label: (v.week_label as string | null) ?? null, videos: [] };
      bucket.videos.push({ id: v.id as string, title: v.title as string });
      byWeek.set(key, bucket);
    }

    const weeks = Array.from(byWeek.values())
      .map((w) => ({
        ...w,
        link: w.week_label ? (linkByWeek.get(w.week_label) ?? null) : null,
      }))
      .sort((a, b) => {
        if (!a.week_label) return 1;
        if (!b.week_label) return -1;
        return b.week_label.localeCompare(a.week_label);
      });

    return weeks;
  });

/** 선택한 주차별로 외부 "과제 점검"에 과제를 1건씩 생성/갱신 */
export const pushWeekAssignmentsToExternal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        classId: z.string().uuid(),
        /** 특정 교육원 학생만 내보낼 때 사용 (없으면 전체) */
        branch: z.string().trim().min(1).nullish(),
        weeks: z
          .array(
            z.object({
              weekLabel: z.string().regex(/^\d{4}-\d{2}-[1-5]$/),
              assignmentType: z.string().trim().min(1).max(200),
              periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
              periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            }),
          )
          .min(1)
          .max(20),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertExternalAssignmentStaff(context as any);

    const { data: klass, error: classErr } = await context.supabase
      .from("classes")
      .select("id, name, branch")
      .eq("id", data.classId)
      .is("deleted_at", null)
      .maybeSingle();

    if (classErr) throw new Error(classErr.message);
    if (!klass) throw new Error("수강반을 찾을 수 없거나 권한이 없습니다.");

    const { data: enrolled, error: enrollErr } = await context.supabase
      .from("class_students")
      .select("user_id")
      .eq("class_id", data.classId)
      .is("deleted_at", null);
    if (enrollErr) throw new Error(enrollErr.message);
    const userIds = (enrolled ?? []).map((r: any) => r.user_id as string);
    if (userIds.length === 0) throw new Error("이 수강반에 배정된 학생이 없습니다.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: allStudents } = await supabaseAdmin
      .from("external_students")
      .select("external_id, auth_user_id, branch")
      .in("auth_user_id", userIds)
      .eq("is_deleted", false);

    const students = data.branch
      ? (allStudents ?? []).filter((s: any) =>
          data.branch === "미지정" ? !s.branch : (s.branch ?? null) === data.branch,
        )
      : (allStudents ?? []);

    const externalStudentIds = Array.from(
      new Set((students ?? []).map((s) => s.external_id).filter((v): v is string => !!v)),
    );
    if (externalStudentIds.length === 0) {
      throw new Error(
        data.branch
          ? `${data.branch} 교육원에 해당하는 학생이 없습니다.`
          : "외부 시스템에서 식별 가능한 학생이 없습니다. (학생 명부 동기화 필요)",
      );
    }

    // 학생별 교육원 (외부에서 담당 계정/필터 판정에 사용)
    const studentBranches: Record<string, string | null> = {};
    for (const s of students ?? []) {
      if (s.external_id) studentBranches[s.external_id as string] = (s as any).branch ?? null;
    }

    const payloadBranch =
      data.branch && data.branch !== "미지정" ? data.branch : ((klass as any).branch ?? null);


    const { pushAssignmentSync } = await import("./external-assignment.server");
    const results: { weekLabel: string; ok: boolean; error?: string }[] = [];

    for (const w of data.weeks) {
      const externalId = data.branch
        ? `class-${data.classId}-week-${w.weekLabel}-${data.branch}`
        : `class-${data.classId}-week-${w.weekLabel}`;

      let remoteAssignmentTypeId: string | null = null;
      let lastError: string | null = null;
      try {
        const res = await pushAssignmentSync({
          external_id: externalId,
          assignment_type: w.assignmentType.slice(0, 200),
          scope: "individual",
          target: {
            class_name: klass.name,
            week: w.weekLabel,
            branch: payloadBranch,
            student_branches: studentBranches,
          },
          period: { start: w.periodStart, end: w.periodEnd },
          students: externalStudentIds,
          branch: payloadBranch,
          student_branches: studentBranches,
        });

        remoteAssignmentTypeId = res.remoteAssignmentTypeId;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }

      const { error: upsertErr } = await supabaseAdmin
        .from("external_assignment_links")
        .upsert(
          {
            source: "elearning",
            external_id: externalId,
            class_id: data.classId,
            video_id: null,
            week_label: w.weekLabel,
            assignment_type: w.assignmentType.slice(0, 200),
            scope: "individual",
            period_start: w.periodStart,
            period_end: w.periodEnd,
            remote_assignment_type_id: remoteAssignmentTypeId,
            student_count: externalStudentIds.length,
            last_synced_at: lastError ? null : new Date().toISOString(),
            last_error: lastError,
            created_by: context.userId,
            deleted_at: null,
            deleted_by: null,
          },
          { onConflict: "source,external_id" },
        );
      if (upsertErr) throw new Error(upsertErr.message);

      results.push({ weekLabel: w.weekLabel, ok: !lastError, ...(lastError ? { error: lastError } : {}) });
    }

    return {
      ok: results.every((r) => r.ok),
      studentCount: externalStudentIds.length,
      skipped: userIds.length - externalStudentIds.length,
      results,
    };
  });

/** 수강반 배정 학생들의 교육원 목록 (인원수 포함) */
export const listClassStudentBranches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ classId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertExternalAssignmentStaff(context as any);

    const { data: enrolled, error } = await context.supabase
      .from("class_students")
      .select("user_id")
      .eq("class_id", data.classId)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    const userIds = (enrolled ?? []).map((r: any) => r.user_id as string);
    if (userIds.length === 0) return [] as { branch: string; count: number }[];

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: students } = await supabaseAdmin
      .from("external_students")
      .select("branch, external_id")
      .in("auth_user_id", userIds)
      .eq("is_deleted", false);

    const counts = new Map<string, number>();
    for (const s of students ?? []) {
      if (!(s as any).external_id) continue;
      const b = ((s as any).branch as string | null) ?? "미지정";
      counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([branch, count]) => ({ branch, count }))
      .sort((a, b) => a.branch.localeCompare(b.branch));
  });

async function staffClassScope(context: any): Promise<Set<string> | null> {
  const role = await assertExternalAssignmentStaff(context);
  if (role === "admin") return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("class_instructors")
    .select("class_id")
    .eq("instructor_user_id", context.userId)
    .is("deleted_at", null);
  return new Set((data ?? []).map((r: any) => r.class_id as string));
}

export type SyncCheckReason = "missing" | "failed" | "resync" | "timeout";

/** 연동 점검 대상: 주차 영상이 있는데 과제 미생성/실패/재통보 필요(/응답 지연) 인 [수강반, 주차] */
export const listSyncCheckTargets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ includeTimeout: z.boolean().optional() }).parse(i ?? {}))
  .handler(async ({ data, context }) => {
    const scope = await staffClassScope(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: vids, error } = await supabaseAdmin
      .from("videos")
      .select("class_id, week_label")
      .not("week_label", "is", null)
      .not("class_id", "is", null)
      .is("deleted_at", null)
      .limit(100000);
    if (error) throw new Error(error.message);
    const { data: links } = await supabaseAdmin
      .from("external_assignment_links")
      .select("class_id, week_label, external_id, last_error, deleted_at, needs_resync, sync_status")
      .eq("source", "elearning")
      .not("week_label", "is", null)
      .limit(100000);

    const keys = new Set<string>();
    for (const v of vids ?? []) {
      if (scope && !scope.has(v.class_id as string)) continue;
      keys.add(`${v.class_id}|${v.week_label}`);
    }
    const linksByKey = new Map<string, any[]>();
    for (const l of links ?? []) {
      const k = `${l.class_id}|${l.week_label}`;
      const arr = linksByKey.get(k) ?? [];
      arr.push(l);
      linksByKey.set(k, arr);
    }

    const rows: { classId: string; weekLabel: string; reasons: SyncCheckReason[]; lastError: string | null }[] = [];
    for (const k of keys) {
      const [classId, weekLabel] = k.split("|") as [string, string];
      const all = linksByKey.get(k) ?? [];
      const active = all.filter((l) => !l.deleted_at);
      const base = `class-${classId}-week-${weekLabel}`;
      const reasons: SyncCheckReason[] = [];
      if (active.length === 0) {
        // 관리자가 지운 주차 과제는 대상 아님
        if (all.some((l) => l.external_id === base && l.deleted_at)) continue;
        reasons.push("missing");
      } else {
        if (active.some((l) => l.last_error)) reasons.push("failed");
        if (active.some((l) => l.sync_status === "timeout")) reasons.push("timeout");
        if (active.some((l) => l.needs_resync)) reasons.push("resync");
      }
      const effective = reasons.filter((r) => r !== "timeout" || data.includeTimeout);
      if (effective.length === 0) continue;
      rows.push({
        classId,
        weekLabel,
        reasons: effective,
        lastError: active.find((l) => l.last_error)?.last_error ?? null,
      });
    }
    if (rows.length === 0) return [];

    const classIds = Array.from(new Set(rows.map((r) => r.classId)));
    const { data: classes } = await supabaseAdmin
      .from("classes")
      .select("id, name")
      .in("id", classIds)
      .is("deleted_at", null);
    const nameById = new Map((classes ?? []).map((c: any) => [c.id as string, c.name as string]));
    const { data: enrolled } = await supabaseAdmin
      .from("class_students")
      .select("class_id")
      .in("class_id", classIds)
      .is("deleted_at", null)
      .limit(100000);
    const countById = new Map<string, number>();
    for (const e of enrolled ?? []) countById.set(e.class_id as string, (countById.get(e.class_id as string) ?? 0) + 1);

    return rows
      .filter((r) => nameById.has(r.classId))
      .map((r) => ({ ...r, className: nameById.get(r.classId)!, studentCount: countById.get(r.classId) ?? 0 }))
      .sort((a, b) => a.className.localeCompare(b.className) || a.weekLabel.localeCompare(b.weekLabel));
  });

/** 연동 점검 1건 처리: 과제 생성/갱신 → 성공하면 재통보(최대 50명) */
export const syncOneWeekAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        classId: z.string().uuid(),
        weekLabel: z.string().regex(/^\d{4}-\d{2}-[1-5]$/),
        force: z.boolean().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const scope = await staffClassScope(context);
    if (scope && !scope.has(data.classId)) throw new Error("담당 수강반만 처리할 수 있습니다.");
    const t0 = Date.now();
    const { autoPushWeekAssignment } = await import("./external-assignment-auto.server");
    const { resyncWeekBatch, markResyncDone } = await import("./external-assignment-resync.server");

    const push = await autoPushWeekAssignment({
      classId: data.classId,
      weekLabel: data.weekLabel,
      userId: context.userId,
      force: !!data.force,
    });
    if (push.outcome === "failed" || push.outcome === "none") {
      return { push: push.outcome, error: push.error ?? (push.outcome === "none" ? "대상 학생이 없습니다." : null), sent: 0, failed: 0, remaining: 0, ms: Date.now() - t0 };
    }
    const r = await resyncWeekBatch({ classId: data.classId, weekLabel: data.weekLabel, batchSize: 50 });
    if ((r.remaining ?? 0) === 0 && r.failed === 0) await markResyncDone(data.classId, data.weekLabel);
    return { push: push.outcome, error: null, sent: r.sent, failed: r.failed, remaining: r.remaining ?? 0, ms: Date.now() - t0 };
  });
