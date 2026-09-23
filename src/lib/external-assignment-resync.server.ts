/**
 * 주차 과제 완료 재통보 (서버 전용, 공용 로직).
 * - 학생당 1번만 호출 (그 주차에서 가장 늦게 완료한 영상 기준)
 * - 동시성 제한(4)으로 순차 처리해 중복 전송/삽입 충돌을 막는다.
 */
import type { NotifyResult } from "./external-assignment-notify.server";

export type ResyncSummary = {
  sent: number;
  alreadySent: number;
  notComplete: number;
  failed: number;
  total: number;
};

const CONCURRENCY = 4;

export async function resyncWeekCompletions(params: {
  classId: string;
  weekLabel: string;
  userIds?: string[];
}): Promise<ResyncSummary> {
  const { classId, weekLabel, userIds } = params;
  const empty: ResyncSummary = { sent: 0, alreadySent: 0, notComplete: 0, failed: 0, total: 0 };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { notifyVideoCompletion } = await import("./external-assignment-notify.server");

  const { data: videos, error: vidErr } = await supabaseAdmin
    .from("videos")
    .select("id")
    .eq("class_id", classId)
    .eq("week_label", weekLabel)
    .eq("is_published", true)
    .is("deleted_at", null);
  if (vidErr) throw new Error(vidErr.message);
  const videoIds = (videos ?? []).map((v) => v.id as string);
  if (videoIds.length === 0) return empty;

  let progQuery = supabaseAdmin
    .from("video_progress")
    .select("user_id, video_id, completed_at, updated_at")
    .in("video_id", videoIds)
    .eq("is_completed", true);
  if (userIds && userIds.length > 0) progQuery = progQuery.in("user_id", userIds);
  const { data: rows, error: progErr } = await progQuery;
  if (progErr) throw new Error(progErr.message);

  // 학생당 1건 (완료 시각이 가장 늦은 영상)
  const latestByUser = new Map<string, { videoId: string; at: string }>();
  for (const r of rows ?? []) {
    const u = r.user_id as string;
    const at = ((r.completed_at ?? r.updated_at) as string | null) ?? "";
    const cur = latestByUser.get(u);
    if (!cur || at > cur.at) latestByUser.set(u, { videoId: r.video_id as string, at });
  }

  const targets = Array.from(latestByUser.entries());
  const summary: ResyncSummary = { ...empty, total: targets.length };
  if (targets.length === 0) return summary;

  const count = (result: NotifyResult) => {
    if (result === "sent") summary.sent += 1;
    else if (result === "already_sent") summary.alreadySent += 1;
    else if (result === "not_complete") summary.notComplete += 1;
    else summary.failed += 1;
  };

  let cursor = 0;
  const worker = async () => {
    while (cursor < targets.length) {
      const idx = cursor++;
      const entry = targets[idx];
      if (!entry) break;
      const [userId, info] = entry;
      try {
        count(await notifyVideoCompletion(userId, info.videoId));
      } catch (e) {
        summary.failed += 1;
        console.error("[external-assignment] resync failed", userId, e);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () => worker()),
  );

  return summary;
}
