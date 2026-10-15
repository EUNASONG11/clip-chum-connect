/**
 * 주차 과제 완료 재통보 (서버 전용, 일괄 조회 방식).
 * - 주차 영상, 링크, 학생, 진도, 기존 통보 내역을 한 번씩만 조회한다.
 * - "주차 영상 전부 완료 && 아직 sent 아님"인 학생에게만 외부 완료 API를 호출한다.
 * - 한 번에 최대 batchSize 명만 처리하고, 남은 인원이 있으면 needs_resync 를 유지한다.
 * - occurred_at 보정, 교육원별 링크 선택 규칙은 notifyVideoCompletion 과 동일.
 */
import { pushAssignmentComplete } from "./external-assignment.server";
import { formatWeekLabel, weekRangeForExternal } from "./week";
import { fetchAll, fetchAllIn } from "./fetch-all";

export type ResyncSummary = {
  sent: number;
  alreadySent: number;
  notComplete: number;
  failed: number;
  total: number;
  /** 이번 호출에서 처리하지 못하고 남은 인원 */
  remaining?: number;
  /** 진도(완료) 조회 행 수 */
  progressRows?: number;
  /** 주차 영상 전부 완료한 인원 */
  fullCount?: number;
};

const COMPLETED_STATUS = "review_completed";
const CONCURRENCY = 4;

type Link = { id: string; external_id: string; assignment_type: string };

export async function resyncWeekBatch(params: {
  classId: string;
  weekLabel: string;
  userIds?: string[];
  batchSize?: number;
}): Promise<ResyncSummary> {
  const { classId, weekLabel, userIds } = params;
  const batchSize = params.batchSize ?? 50;
  const summary: ResyncSummary = { sent: 0, alreadySent: 0, notComplete: 0, failed: 0, total: 0, remaining: 0 };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: videos, error: vidErr } = await supabaseAdmin
    .from("videos")
    .select("id")
    .eq("class_id", classId)
    .eq("week_label", weekLabel)
    .eq("is_published", true)
    .is("deleted_at", null);
  if (vidErr) throw new Error(vidErr.message);
  const videoIds = (videos ?? []).map((v) => v.id as string);

  const { data: linkRows, error: linkErr } = await supabaseAdmin
    .from("external_assignment_links")
    .select("id, external_id, assignment_type")
    .eq("class_id", classId)
    .eq("week_label", weekLabel)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (linkErr) throw new Error(linkErr.message);
  const links = (linkRows ?? []) as Link[];
  if (videoIds.length === 0 || links.length === 0) return summary;

  // 진도 (완료만)
  const prog = await fetchAll<any>((f, t) => {
    let q = supabaseAdmin
      .from("video_progress")
      .select("id, user_id, video_id, completed_at, updated_at")
      .in("video_id", videoIds)
      .eq("is_completed", true);
    if (userIds && userIds.length > 0) q = q.in("user_id", userIds.slice(0, 200));
    return q.order("id").range(f, t) as any;
  });
  summary.progressRows = prog.length;

  const byUser = new Map<string, { videos: Set<string>; latestVideo: string; at: string }>();
  for (const r of prog) {
    const u = r.user_id as string;
    const at = ((r.completed_at ?? r.updated_at) as string | null) ?? "";
    const cur = byUser.get(u) ?? { videos: new Set<string>(), latestVideo: r.video_id as string, at: "" };
    cur.videos.add(r.video_id as string);
    if (at >= cur.at) {
      cur.at = at;
      cur.latestVideo = r.video_id as string;
    }
    byUser.set(u, cur);
  }
  summary.total = byUser.size;

  const fullUsers: string[] = [];
  for (const [u, info] of byUser) {
    if (info.videos.size >= videoIds.length) fullUsers.push(u);
    else summary.notComplete += 1;
  }
  summary.fullCount = fullUsers.length;
  if (fullUsers.length === 0) return summary;

  const studs = await fetchAllIn<any>(fullUsers, (ids, f, t) =>
    supabaseAdmin
      .from("external_students")
      .select("id, auth_user_id, external_id, branch")
      .in("auth_user_id", ids)
      .order("id")
      .range(f, t) as any,
  );
  const studentByUser = new Map<string, { external_id: string; branch: string | null }>();
  for (const s of studs) {
    if (s.auth_user_id && s.external_id) {
      studentByUser.set(s.auth_user_id as string, {
        external_id: s.external_id as string,
        branch: ((s as any).branch ?? null) as string | null,
      });
    }
  }

  const base = `class-${classId}-week-${weekLabel}`;
  const generalLink = links.find((l) => l.external_id === base);
  const pickLink = (branch: string | null): Link | null => {
    const b = branch ? links.find((l) => l.external_id === `${base}-${branch}`) : undefined;
    return b ?? generalLink ?? null;
  };

  const linkIds = links.map((l) => l.id);
  const comps = await fetchAllIn<any>(fullUsers, (ids, f, t) =>
    supabaseAdmin
      .from("external_assignment_completions")
      .select("id, link_id, user_id, status")
      .in("link_id", linkIds)
      .in("user_id", ids)
      .order("id")
      .range(f, t) as any,
  );
  const compKey = (linkId: string, userId: string) => `${linkId}|${userId}`;
  const compMap = new Map<string, { id: string; status: string }>();
  for (const c of comps) compMap.set(compKey(c.link_id as string, c.user_id as string), c as any);

  const { start, end } = weekRangeForExternal(weekLabel);
  const s = new Date(`${start}T00:00:00+09:00`).getTime();
  const e = new Date(`${end}T23:59:59+09:00`).getTime();
  const memo = `이러닝: ${formatWeekLabel(weekLabel)} 영상 ${videoIds.length}개 시청 완료`;

  type Job = { userId: string; link: Link; studentId: string; branch: string | null; occurredAt: string; videoId: string; existingId: string | null };
  const jobs: Job[] = [];
  for (const u of fullUsers) {
    const st = studentByUser.get(u);
    if (!st) continue;
    const link = pickLink(st.branch);
    if (!link) continue;
    const ex = compMap.get(compKey(link.id, u));
    if (ex?.status === "sent") {
      summary.alreadySent += 1;
      continue;
    }
    const info = byUser.get(u)!;
    let occurredAt = info.at || new Date().toISOString();
    const t = new Date(occurredAt).getTime();
    if (Number.isNaN(t) || t < s || t > e) occurredAt = new Date(`${end}T12:00:00+09:00`).toISOString();
    jobs.push({ userId: u, link, studentId: st.external_id, branch: st.branch, occurredAt, videoId: info.latestVideo, existingId: ex?.id ?? null });
  }

  const batch = jobs.slice(0, batchSize);
  summary.remaining = jobs.length - batch.length;
  if (batch.length === 0) return summary;

  const toInsert = batch
    .filter((j) => !j.existingId)
    .map((j) => ({ link_id: j.link.id, user_id: j.userId, video_id: j.videoId, status: "pending", occurred_at: j.occurredAt }));
  if (toInsert.length > 0) {
    await supabaseAdmin
      .from("external_assignment_completions")
      .upsert(toInsert, { onConflict: "link_id,user_id", ignoreDuplicates: true });
  }

  let cursor = 0;
  const worker = async () => {
    while (cursor < batch.length) {
      const j = batch[cursor++];
      if (!j) break;
      try {
        await pushAssignmentComplete({
          external_id: j.link.external_id,
          student_id: j.studentId,
          assignment_type: j.link.assignment_type,
          status: COMPLETED_STATUS,
          memo,
          occurred_at: j.occurredAt,
          branch: j.branch,
        });
        await supabaseAdmin
          .from("external_assignment_completions")
          .update({ status: "sent", remote_status: COMPLETED_STATUS, error_message: null, sent_at: new Date().toISOString() })
          .eq("link_id", j.link.id)
          .eq("user_id", j.userId);
        summary.sent += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        summary.failed += 1;
        console.error("[external-assignment] resync failed", j.userId, message);
        await supabaseAdmin
          .from("external_assignment_completions")
          .update({ status: "failed", error_message: message.slice(0, 500) })
          .eq("link_id", j.link.id)
          .eq("user_id", j.userId);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batch.length) }, () => worker()));
  return summary;
}

/** 재통보를 끝까지 반복 (화면의 "완료 재통보" 버튼용). 남은 인원이 없으면 needs_resync 해제. */
export async function resyncWeekCompletions(params: {
  classId: string;
  weekLabel: string;
  userIds?: string[];
}): Promise<ResyncSummary> {
  const total: ResyncSummary = { sent: 0, alreadySent: 0, notComplete: 0, failed: 0, total: 0, remaining: 0 };
  for (let i = 0; i < 20; i++) {
    const r = await resyncWeekBatch({ ...params, batchSize: 50 });
    total.sent += r.sent;
    total.failed += r.failed;
    if (i === 0) {
      total.alreadySent = r.alreadySent;
      total.notComplete = r.notComplete;
      total.total = r.total;
    }
    total.remaining = r.remaining ?? 0;
    if (!r.remaining || r.sent === 0) break;
  }
  if (!params.userIds && total.remaining === 0 && total.failed === 0) {
    await markResyncDone(params.classId, params.weekLabel);
  }
  return total;
}

export async function markResyncDone(classId: string, weekLabel: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin
    .from("external_assignment_links")
    .update({ needs_resync: false })
    .eq("class_id", classId)
    .eq("week_label", weekLabel)
    .is("deleted_at", null);
}
