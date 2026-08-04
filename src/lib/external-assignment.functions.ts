import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertStaff(context: { supabase: any; userId: string }) {
  const { data: isAdmin } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (isAdmin) return "admin" as const;
  const { data: isInstructor } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "instructor",
  });
  if (isInstructor) return "instructor" as const;
  throw new Error("관리자 또는 강사만 사용할 수 있습니다.");
}

/** 연동 설정 여부 + 수강반별 내보낸 과제 목록 */
export const getExternalAssignmentStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ classId: z.string().uuid().optional() }).parse(i ?? {}))
  .handler(async ({ data, context }) => {
    await assertStaff(context as any);

    const configured =
      !!process.env["EXTERNAL_ASSIGNMENT_BASE_URL"] && !!process.env["EXTERNAL_SYNC_API_KEY"];

    let query = context.supabase
      .from("external_assignment_links")
      .select("id, external_id, assignment_type, scope, period_start, period_end, remote_assignment_type_id, student_count, last_synced_at, last_error, class_id, created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(50);
    if (data.classId) query = query.eq("class_id", data.classId);

    const { data: links, error } = await query;
    if (error) throw new Error(error.message);

    const linkList = links ?? [];
    const linkIds = linkList.map((l: any) => l.id as string);

    // 링크별 완료 통보 집계 (학생 단위 중복 제거)
    const statsByLink: Record<
      string,
      { completedCount: number; statusCounts: Record<string, number> }
    > = {};

    if (linkIds.length > 0) {
      const { data: comps, error: compErr } = await context.supabase
        .from("external_assignment_completions")
        .select("link_id, user_id, status, remote_status")
        .in("link_id", linkIds);
      if (compErr) throw new Error(compErr.message);

      const seen = new Set<string>();
      for (const c of comps ?? []) {
        const key = `${c.link_id}:${c.user_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const s = (statsByLink[c.link_id] ??= { completedCount: 0, statusCounts: {} });
        const label = (c.remote_status || c.status || "unknown") as string;
        s.statusCounts[label] = (s.statusCounts[label] ?? 0) + 1;
        s.completedCount += 1;
      }
    }

    const enriched = linkList.map((l: any) => {
      const s = statsByLink[l.id] ?? { completedCount: 0, statusCounts: {} };
      const target = l.student_count ?? 0;
      const statusCounts = { ...s.statusCounts };
      const initial = Math.max(0, target - s.completedCount);
      if (initial > 0) statusCounts["initial"] = (statusCounts["initial"] ?? 0) + initial;
      return {
        ...l,
        completed_count: s.completedCount,
        target_count: target,
        status_counts: statusCounts,
      };
    });

    return { configured, links: enriched };
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
    await assertStaff(context as any);

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

    const externalStudentIds = (students ?? [])
      .map((s) => s.external_id)
      .filter((v): v is string => !!v);
    if (externalStudentIds.length === 0) {
      throw new Error("외부 시스템에서 식별 가능한 학생이 없습니다. (학생 명부 동기화 필요)");
    }

    const externalId = data.externalId ?? `class-${data.classId.slice(0, 8)}-${data.periodStart}`;

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
