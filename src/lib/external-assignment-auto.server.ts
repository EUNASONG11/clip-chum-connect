/**
 * 주차가 지정된 영상이 등록되면, 해당 주차의 외부 과제를 기본값으로 자동 생성/갱신한다.
 * 기본값
 *  - 과제명: "{수강반명} {8월 1주차} 영상 과제"
 *  - 기간: 그 주차의 월~토 (weekRangeForExternal)
 *  - 대상: 해당 수강반에 배정된 전원 (교육원 구분 없음)
 * 관리자가 휴지통으로 보낸(soft delete) 주차 과제는 다시 만들지 않는다.
 * 이미 교육원별로 내보낸 주차라면 전체용 과제를 새로 만들지 않고 교육원별 과제만 갱신한다.
 */
import { formatWeekLabel, isWeekLabel, weekRangeForExternal } from "./week";
import { EXTERNAL_SOURCE, pushAssignmentSync } from "./external-assignment.server";

type ExistingLink = {
  external_id: string;
  assignment_type: string | null;
  period_start: string | null;
  period_end: string | null;
  deleted_at: string | null;
} | null;

export async function autoPushWeekAssignment(params: {
  classId: string | null | undefined;
  weekLabel: string | null | undefined;
  userId: string;
  /** 완료 재통보(보정)는 오래 걸릴 수 있어 이 시간까지만 기다린다. 과제 생성 자체는 끝까지 기다린다. */
  resyncWaitMs?: number;
}): Promise<void> {
  const { classId, weekLabel, userId, resyncWaitMs } = params;
  if (!classId || !isWeekLabel(weekLabel)) return;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: klass } = await supabaseAdmin
    .from("classes")
    .select("id, name, branch")
    .eq("id", classId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!klass) return;

  const baseExternalId = `class-${classId}-week-${weekLabel}`;

  // 같은 주차의 기존 링크(전체용 + 교육원별) 조회
  const { data: allLinks } = await supabaseAdmin
    .from("external_assignment_links")
    .select("external_id, assignment_type, period_start, period_end, deleted_at")
    .eq("source", EXTERNAL_SOURCE)
    .eq("class_id", classId)
    .eq("week_label", weekLabel);

  const links = (allLinks ?? []) as NonNullable<ExistingLink>[];
  const baseLink = links.find((l) => l.external_id === baseExternalId) ?? null;
  const branchLinks = links.filter(
    (l) => l.external_id.startsWith(`${baseExternalId}-`) && !l.deleted_at,
  );

  // 대상 학생
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

  const roster = (students ?? []).filter((s: any) => !!s.external_id) as {
    external_id: string;
    branch: string | null;
  }[];
  if (roster.length === 0) return;

  const classBranch = ((klass as any).branch ?? null) as string | null;
  const className = (klass as any).name as string;
  const range = weekRangeForExternal(weekLabel);

  async function upsertOne(
    externalId: string,
    branchFilter: string | null,
    existing: ExistingLink,
  ): Promise<boolean> {
    const targets = branchFilter
      ? roster.filter((s) =>
          branchFilter === "미지정" ? !s.branch : s.branch === branchFilter,
        )
      : roster;

    const externalStudentIds = Array.from(new Set(targets.map((s) => s.external_id)));
    if (externalStudentIds.length === 0) return false;

    const studentBranches: Record<string, string | null> = {};
    for (const s of targets) studentBranches[s.external_id] = s.branch ?? null;

    const assignmentType =
      existing?.assignment_type ?? `${className} ${formatWeekLabel(weekLabel)} 영상 과제`;
    const periodStart = existing?.period_start ?? range.start;
    const periodEnd = existing?.period_end ?? range.end;
    const payloadBranch =
      branchFilter && branchFilter !== "미지정" ? branchFilter : classBranch;

    let remoteAssignmentTypeId: string | null = null;
    let lastError: string | null = null;
    try {
      const res = await pushAssignmentSync({
        external_id: externalId,
        assignment_type: assignmentType.slice(0, 200),
        scope: "individual",
        target: {
          class_name: className,
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
    return !lastError;
  }

  /** 과제 생성/갱신이 성공하면, 이미 다 본 학생에게 완료 통보를 한 번 보정한다. */
  async function resyncOnce(): Promise<void> {
    const work = resyncInner();
    if (resyncWaitMs == null) return work;
    await Promise.race([work, new Promise<void>((r) => setTimeout(r, resyncWaitMs))]);
  }
  async function resyncInner(): Promise<void> {
    try {
      const { resyncWeekCompletions } = await import("./external-assignment-resync.server");
      await resyncWeekCompletions({ classId: classId!, weekLabel: weekLabel as string });
    } catch (e) {
      console.error("[external-assignment] auto resync failed", classId, weekLabel, e);
    }
  }

  if (branchLinks.length > 0) {
    // 교육원별로 내보낸 주차 → 전체용을 만들지 않고 교육원별 과제만 갱신
    let anyOk = false;
    for (const link of branchLinks) {
      const branchFilter = link.external_id.slice(baseExternalId.length + 1) || null;
      if (await upsertOne(link.external_id, branchFilter, link)) anyOk = true;
    }
    if (anyOk) await resyncOnce();
    return;
  }

  // 관리자가 휴지통으로 보낸 전체용 과제는 자동 복구하지 않는다.
  if (baseLink?.deleted_at) return;

  if (await upsertOne(baseExternalId, null, baseLink)) await resyncOnce();
}

/**
 * 저장 응답용: 외부 과제 생성/갱신은 끝까지 기다리고(외부 호출당 최대 15초),
 * 시간이 오래 걸리는 완료 재통보만 짧게 기다린다.
 * (응답 후 남은 작업은 서버에서 중단될 수 있어, 과제 생성은 반드시 응답 전에 끝낸다.)
 */
export async function autoPushWeekAssignmentBounded(
  params: Omit<Parameters<typeof autoPushWeekAssignment>[0], "resyncWaitMs">,
  ms = 3000,
): Promise<void> {
  try {
    await autoPushWeekAssignment({ ...params, resyncWaitMs: ms });
  } catch (e) {
    console.error("[external-assignment] auto push error", e);
  }
}
