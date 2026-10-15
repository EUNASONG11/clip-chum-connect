/**
 * 주차가 지정된 영상이 등록되면, 해당 주차의 외부 과제를 기본값으로 자동 생성/갱신한다.
 * 기본값
 *  - 과제명: "{수강반명} {8월 1주차} 영상 과제"
 *  - 기간: 그 주차의 월~토 (weekRangeForExternal)
 *  - 대상: 해당 수강반에 배정된 전원 (교육원 구분 없음)
 * 관리자가 휴지통으로 보낸(soft delete) 주차 과제는 다시 만들지 않는다.
 * 이미 교육원별로 내보낸 주차라면 전체용 과제를 새로 만들지 않고 교육원별 과제만 갱신한다.
 *
 * 완료 재통보는 여기서 하지 않는다. 생성/갱신에 성공(또는 응답 지연)하면 needs_resync=true 로 남기고,
 * "연동 점검" 기능이 그 표시를 보고 처리한다.
 * 학생 구성·과제명·기간이 지난 전송과 같으면(students_hash) 외부 호출을 건너뛴다.
 */
import { formatWeekLabel, isWeekLabel, weekRangeForExternal } from "./week";
import { EXTERNAL_SOURCE, isTimeoutError, pushAssignmentSync } from "./external-assignment.server";
import { fetchAll, fetchAllIn } from "./fetch-all.server";

type ExistingLink = {
  external_id: string;
  assignment_type: string | null;
  period_start: string | null;
  period_end: string | null;
  deleted_at: string | null;
  last_error: string | null;
  sync_status: string | null;
  students_hash: string | null;
} | null;

/** 건너뜀 사유 */
export type PushSkipReason =
  | "no_enrolled" // 배정 학생 0명
  | "no_external_ids" // 외부 ID 연결된 학생 0명 (명부 동기화 필요)
  | "no_branch_students" // 교육원별 과제인데 해당 교육원 학생 0명
  | "class_deleted"
  | "link_deleted"
  | "invalid"; // 수강반/주차 없음
export type PushOutcome = "sent" | "skipped" | "timeout" | "failed" | PushSkipReason;
export const isSkipReason = (o: PushOutcome): o is PushSkipReason =>
  o !== "sent" && o !== "skipped" && o !== "timeout" && o !== "failed";

async function sha(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function autoPushWeekAssignment(params: {
  classId: string | null | undefined;
  weekLabel: string | null | undefined;
  userId: string;
  /** true 면 지난 전송과 같아도 다시 보낸다 (응답 지연 재확인용) */
  force?: boolean;
}): Promise<{ outcome: PushOutcome; error?: string }> {
  const { classId, weekLabel, userId, force } = params;
  if (!classId || !isWeekLabel(weekLabel)) return { outcome: "invalid" };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: klass } = await supabaseAdmin
    .from("classes")
    .select("id, name, branch")
    .eq("id", classId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!klass) return { outcome: "class_deleted" };

  const baseExternalId = `class-${classId}-week-${weekLabel}`;

  const { data: allLinks } = await supabaseAdmin
    .from("external_assignment_links")
    .select("external_id, assignment_type, period_start, period_end, deleted_at, last_error, sync_status, students_hash")
    .eq("source", EXTERNAL_SOURCE)
    .eq("class_id", classId)
    .eq("week_label", weekLabel);

  const links = (allLinks ?? []) as NonNullable<ExistingLink>[];
  const baseLink = links.find((l) => l.external_id === baseExternalId) ?? null;
  const branchLinks = links.filter(
    (l) => l.external_id.startsWith(`${baseExternalId}-`) && !l.deleted_at,
  );

  const enrolled = await fetchAll<{ user_id: string }>((f, t) =>
    supabaseAdmin
      .from("class_students")
      .select("user_id")
      .eq("class_id", classId)
      .is("deleted_at", null)
      .order("user_id")
      .range(f, t) as any,
  );
  const userIds = Array.from(new Set(enrolled.map((r) => r.user_id)));
  if (userIds.length === 0) return { outcome: "no_enrolled" };

  const students = await fetchAllIn<{ external_id: string | null; auth_user_id: string; branch: string | null }>(
    userIds,
    (ids, f, t) =>
      supabaseAdmin
        .from("external_students")
        .select("external_id, auth_user_id, branch")
        .in("auth_user_id", ids)
        .eq("is_deleted", false)
        .order("auth_user_id")
        .range(f, t) as any,
  );

  const roster = (students ?? []).filter((s: any) => !!s.external_id) as {
    external_id: string;
    branch: string | null;
  }[];
  if (roster.length === 0) return { outcome: "no_external_ids" };

  const classBranch = ((klass as any).branch ?? null) as string | null;
  const className = (klass as any).name as string;
  const range = weekRangeForExternal(weekLabel);

  async function upsertOne(
    externalId: string,
    branchFilter: string | null,
    existing: ExistingLink,
  ): Promise<{ outcome: PushOutcome; error?: string }> {
    const targets = branchFilter
      ? roster.filter((s) =>
          branchFilter === "미지정" ? !s.branch : s.branch === branchFilter,
        )
      : roster;

    const externalStudentIds = Array.from(new Set(targets.map((s) => s.external_id))).sort();
    if (externalStudentIds.length === 0) {
      return { outcome: branchFilter ? "no_branch_students" : "no_external_ids" };
    }

    const branchById = new Map<string, string | null>();
    for (const s of targets) branchById.set(s.external_id, s.branch ?? null);
    // 정렬된 id 순서로 만든다 (DB 반환 순서와 무관하게 해시가 같도록)
    const studentBranches: Record<string, string | null> = {};
    const branchPairs: [string, string | null][] = [];
    for (const id of externalStudentIds) {
      const b = branchById.get(id) ?? null;
      studentBranches[id] = b;
      branchPairs.push([id, b]);
    }

    const assignmentType = (
      existing?.assignment_type ?? `${className} ${formatWeekLabel(weekLabel)} 영상 과제`
    ).slice(0, 200);
    const periodStart = existing?.period_start ?? range.start;
    const periodEnd = existing?.period_end ?? range.end;
    const payloadBranch =
      branchFilter && branchFilter !== "미지정" ? branchFilter : classBranch;

    const hash = await sha(
      JSON.stringify(["v2", assignmentType, periodStart, periodEnd, branchPairs]),
    );

    // 지난 전송과 같으면 외부 호출 생략 (실패 건은 재시도)
    const unchangedBase = !force && existing && !existing.deleted_at && !existing.last_error;
    if (unchangedBase && existing!.students_hash === hash) {
      return { outcome: "skipped" };
    }
    // 이전 방식(v1) 해시와 같으면 다시 보내지 않고 저장값만 새 방식으로 바꾼다.
    if (unchangedBase && existing!.students_hash) {
      const legacyCandidates: Record<string, string | null>[] = [studentBranches];
      const dbOrder: Record<string, string | null> = {};
      for (const s of targets) dbOrder[s.external_id] = s.branch ?? null;
      legacyCandidates.push(dbOrder);
      for (const sb of legacyCandidates) {
        const legacy = await sha(
          JSON.stringify([assignmentType, periodStart, periodEnd, externalStudentIds, sb]),
        );
        if (legacy === existing!.students_hash) {
          await supabaseAdmin
            .from("external_assignment_links")
            .update({ students_hash: hash })
            .eq("source", EXTERNAL_SOURCE)
            .eq("external_id", externalId);
          return { outcome: "skipped" };
        }
      }
    }

    let remoteAssignmentTypeId: string | null = null;
    let lastError: string | null = null;
    let timedOut = false;
    try {
      const res = await pushAssignmentSync({
        external_id: externalId,
        assignment_type: assignmentType,
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
      if (isTimeoutError(e)) timedOut = true;
      else lastError = e instanceof Error ? e.message : String(e);
    }

    const ok = !lastError;
    await supabaseAdmin.from("external_assignment_links").upsert(
      {
        source: EXTERNAL_SOURCE,
        external_id: externalId,
        class_id: classId,
        video_id: null,
        week_label: weekLabel,
        assignment_type: assignmentType,
        scope: "individual",
        period_start: periodStart,
        period_end: periodEnd,
        ...(remoteAssignmentTypeId ? { remote_assignment_type_id: remoteAssignmentTypeId } : {}),
        student_count: externalStudentIds.length,
        last_synced_at: ok && !timedOut ? new Date().toISOString() : null,
        last_error: lastError,
        sync_status: timedOut ? "timeout" : ok ? "ok" : "failed",
        students_hash: ok ? hash : null,
        ...(ok ? { needs_resync: true } : {}),
        created_by: userId,
        deleted_at: null,
        deleted_by: null,
      },
      { onConflict: "source,external_id" },
    );

    if (lastError) {
      console.error("[external-assignment] auto push failed", externalId, lastError);
      return { outcome: "failed", error: lastError };
    }
    return { outcome: timedOut ? "timeout" : "sent" };
  }

  const rank = (o: PushOutcome) =>
    o === "failed" ? 4 : o === "timeout" ? 3 : o === "sent" ? 2 : o === "skipped" ? 1 : 0;

  if (branchLinks.length > 0) {
    let worst: { outcome: PushOutcome; error?: string } | null = null;
    for (const link of branchLinks) {
      const branchFilter = link.external_id.slice(baseExternalId.length + 1) || null;
      const r = await upsertOne(link.external_id, branchFilter, link);
      if (!worst || rank(r.outcome) > rank(worst.outcome)) worst = r;
    }
    return worst!;
  }

  if (baseLink?.deleted_at) return { outcome: "link_deleted" };
  return upsertOne(baseExternalId, null, baseLink);
}

/** 저장 응답용: 과제 생성/갱신까지만 하고 재통보는 하지 않는다. 오류는 저장을 막지 않는다. */
export async function autoPushWeekAssignmentBounded(
  params: Omit<Parameters<typeof autoPushWeekAssignment>[0], "force">,
): Promise<void> {
  try {
    await autoPushWeekAssignment(params);
  } catch (e) {
    console.error("[external-assignment] auto push error", e);
  }
}
