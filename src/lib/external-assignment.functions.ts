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
      .select("id, external_id, assignment_type, scope, period_start, period_end, remote_assignment_type_id, student_count, last_synced_at, last_error, class_id, video_id, created_at")
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

/** 이미 완료된 시청 기록을 외부 "과제 점검"에 재통보 (누락분 보정) */
export const resyncCompletionsToExternal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ classId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertExternalAssignmentStaff(context as any);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { notifyVideoCompletion } = await import("./external-assignment-notify.server");

    const { data: videos, error: vidErr } = await supabaseAdmin
      .from("videos")
      .select("id")
      .eq("class_id", data.classId)
      .is("deleted_at", null);
    if (vidErr) throw new Error(vidErr.message);
    const videoIds = (videos ?? []).map((v) => v.id as string);
    if (videoIds.length === 0) return { sent: 0, total: 0 };

    const { data: rows, error: progErr } = await supabaseAdmin
      .from("video_progress")
      .select("user_id, video_id")
      .in("video_id", videoIds)
      .eq("is_completed", true);
    if (progErr) throw new Error(progErr.message);

    let sent = 0;
    for (const r of rows ?? []) {
      try {
        await notifyVideoCompletion(r.user_id as string, r.video_id as string);
        sent += 1;
      } catch (e) {
        console.error("[external-assignment] resync failed", e);
      }
    }
    return { sent, total: (rows ?? []).length };
  });
