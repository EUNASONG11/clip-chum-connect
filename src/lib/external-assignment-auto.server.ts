/**
 * 주차가 지정된 영상이 등록되면, 해당 주차의 외부 과제를 기본값으로 자동 생성/갱신한다.
 * 기본값
 *  - 과제명: "{수강반명} {8월 1주차} 영상 과제"
 *  - 기간: 그 주차의 월~토 (weekRangeForExternal)
 *  - 대상: 해당 수강반에 배정된 전원 (교육원 구분 없음)
 * 관리자가 휴지통으로 보낸(soft delete) 주차 과제는 다시 만들지 않는다.
 */
import { formatWeekLabel, isWeekLabel, weekRangeForExternal } from "./week";
import { EXTERNAL_SOURCE, pushAssignmentSync } from "./external-assignment.server";

export async function autoPushWeekAssignment(params: {
  classId: string | null | undefined;
  weekLabel: string | null | undefined;
  userId: string;
}): Promise<void> {
  const { classId, weekLabel, userId } = params;
  if (!classId || !isWeekLabel(weekLabel)) return;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: klass } = await supabaseAdmin
    .from("classes")
    .select("id, name, branch")
    .eq("id", classId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!klass) return;

  const externalId = `class-${classId}-week-${weekLabel}`;

  // 이미 삭제 처리된 주차 과제는 자동 복구하지 않는다.
  const { data: existing } = await supabaseAdmin
    .from("external_assignment_links")
    .select("id, deleted_at, assignment_type, period_start, period_end")
    .eq("source", EXTERNAL_SOURCE)
    .eq("external_id", externalId)
    .maybeSingle();
  if (existing?.deleted_at) return;

  const { data: enrolled } = await supabaseAdmin
    .from("class_students")
    .select("user_id")
    .eq("class_id", classId)
    .is("deleted_at", null);
  const userIds = (enrolled ?? []).map((r: any) => r.user_id as string);
  if (userIds.length === 0) return;

  const { data: students } = await supabaseAdmin
    .from("external_students")
    .select("external_id, auth_user_id, branch")
    .in("auth_user_id", userIds)
    .eq("is_deleted", false);

  const externalStudentIds = Array.from(
    new Set((students ?? []).map((s: any) => s.external_id).filter((v: any): v is string => !!v)),
  );
  if (externalStudentIds.length === 0) return;

  const studentBranches: Record<string, string | null> = {};
  for (const s of students ?? []) {
    if ((s as any).external_id) studentBranches[(s as any).external_id as string] = (s as any).branch ?? null;
  }

  const assignmentType =
    (existing?.assignment_type as string | null) ??
    `${(klass as any).name} ${formatWeekLabel(weekLabel)} 영상 과제`;
  const range = weekRangeForExternal(weekLabel);
  const periodStart = (existing?.period_start as string | null) ?? range.start;
  const periodEnd = (existing?.period_end as string | null) ?? range.end;
  const payloadBranch = ((klass as any).branch ?? null) as string | null;

  let remoteAssignmentTypeId: string | null = null;
  let lastError: string | null = null;
  try {
    const res = await pushAssignmentSync({
      external_id: externalId,
      assignment_type: assignmentType.slice(0, 200),
      scope: "individual",
      target: {
        class_name: (klass as any).name,
        week: weekLabel,
        branch: payloadBranch,
        student_branches: studentBranches,
      },
      period: { start: periodStart, end: periodEnd },
      students: externalStudentIds,
      branch: payloadBranch,
      student_branches: studentBranches,
    });
    remoteAssignmentTypeId = res.remoteAssignmentTypeId;
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
  }

  await supabaseAdmin.from("external_assignment_links").upsert(
    {
      source: EXTERNAL_SOURCE,
      external_id: externalId,
      class_id: classId,
      video_id: null,
      week_label: weekLabel,
      assignment_type: assignmentType.slice(0, 200),
      scope: "individual",
      period_start: periodStart,
      period_end: periodEnd,
      remote_assignment_type_id: remoteAssignmentTypeId,
      student_count: externalStudentIds.length,
      last_synced_at: lastError ? null : new Date().toISOString(),
      last_error: lastError,
      created_by: userId,
      deleted_at: null,
      deleted_by: null,
    },
    { onConflict: "source,external_id" },
  );

  if (lastError) console.error("[external-assignment] auto push failed", externalId, lastError);
}
