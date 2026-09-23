/**
 * 영상 시청 완료 → 외부 "과제 점검" 완료 통보 (서버 전용, best-effort).
 * 실패해도 학생의 진도 저장을 막지 않도록 호출부에서 try/catch 합니다.
 *
 * 연결 우선순위:
 *  1) 주차 과제 (videos.week_label ↔ external_assignment_links.week_label)
 *     → 해당 주차의 모든 활성 영상을 완료했을 때만 통보
 *  2) 영상별 과제 (구버전)
 *  3) 수강반 단위 과제 (구버전)
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isExternalAssignmentConfigured, pushAssignmentComplete } from "./external-assignment.server";
import { formatWeekLabel, weekRangeForExternal } from "./week";

const COMPLETED_STATUS = "review_completed";

type LinkRow = { id: string; external_id: string; assignment_type: string };

/** 주차 과제 완료 조건: 해당 주차의 활성 영상을 모두 완료했는지 */
async function weekFullyCompleted(
  userId: string,
  classId: string,
  weekLabel: string,
): Promise<{ ok: boolean; total: number; done: number }> {
  const { data: weekVideos } = await supabaseAdmin
    .from("videos")
    .select("id")
    .eq("class_id", classId)
    .eq("week_label", weekLabel)
    .eq("is_published", true)
    .is("deleted_at", null);

  const ids = (weekVideos ?? []).map((v) => v.id as string);
  if (ids.length === 0) return { ok: false, total: 0, done: 0 };

  const { data: progress } = await supabaseAdmin
    .from("video_progress")
    .select("video_id, is_completed")
    .eq("user_id", userId)
    .in("video_id", ids);

  const done = (progress ?? []).filter((p) => p.is_completed).length;
  return { ok: done >= ids.length, total: ids.length, done };
}

export type NotifyResult =
  | "sent"
  | "already_sent"
  | "not_complete"
  | "no_link"
  | "no_student"
  | "failed";

export async function notifyVideoCompletion(
  userId: string,
  videoId: string,
): Promise<NotifyResult> {
  if (!isExternalAssignmentConfigured()) return "no_link";

  const { data: video } = await supabaseAdmin
    .from("videos")
    .select("id, class_id, title, week_label")
    .eq("id", videoId)
    .maybeSingle();
  if (!video?.class_id) return "no_link";

  // 외부 시스템이 아는 학생 식별자 (마스터 students.id)
  const { data: student } = await supabaseAdmin
    .from("external_students")
    .select("external_id, branch")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (!student?.external_id) return "no_student";


  let links: LinkRow[] = [];
  let memo = `이러닝: "${video.title}" 시청 완료`;
  let weekLinked = false;

  // 1순위: 주차 과제
  const weekLabel = (video as any).week_label as string | null;
  if (weekLabel) {
    const { data: weekLinks } = await supabaseAdmin
      .from("external_assignment_links")
      .select("id, external_id, assignment_type")
      .eq("class_id", video.class_id)
      .eq("week_label", weekLabel)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    const all = (weekLinks ?? []) as LinkRow[];
    if (all.length > 0) {
      // 교육원별로 분리 내보낸 과제가 있으면 학생 교육원에 맞는 링크를 선택
      const studentBranch = ((student as any).branch ?? null) as string | null;
      const base = `class-${video.class_id}-week-${weekLabel}`;
      const branchLink = studentBranch
        ? all.find((l) => l.external_id === `${base}-${studentBranch}`)
        : undefined;
      const generalLink = all.find((l) => l.external_id === base);
      const picked = branchLink ?? generalLink ?? null;

      if (picked) {
        const status = await weekFullyCompleted(userId, video.class_id, weekLabel);
        if (!status.ok) return "not_complete"; // 주차 영상 일부만 완료 → 통보 보류
        links = [picked];
        weekLinked = true;
        memo = `이러닝: ${formatWeekLabel(weekLabel)} 영상 ${status.total}개 시청 완료`;
      } else {
        // 주차 과제는 있는데 이 학생 교육원용 과제가 없으면 구버전 과제로 잘못 보내지 않도록 중단
        return "no_link";
      }
    }
  }




  // 2순위: 해당 영상에 연결된 과제
  if (links.length === 0) {
    const { data: videoLinks } = await supabaseAdmin
      .from("external_assignment_links")
      .select("id, external_id, assignment_type")
      .eq("class_id", video.class_id)
      .eq("video_id", videoId)
      .is("week_label", null)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1);
    links = (videoLinks ?? []) as LinkRow[];
  }

  // 3순위: 수강반 단위 과제(구버전)
  if (links.length === 0) {
    const { data: classLinks } = await supabaseAdmin
      .from("external_assignment_links")
      .select("id, external_id, assignment_type")
      .eq("class_id", video.class_id)
      .is("video_id", null)
      .is("week_label", null)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1);
    links = (classLinks ?? []) as LinkRow[];
  }

  if (links.length === 0) return "no_link";

  // 통보 시각은 "지금"이 아니라 실제 시청 완료 시각을 사용합니다.
  // (외부 시스템이 occurred_at 으로 주차를 계산하기 때문에 지금 시각을 보내면 엉뚱한 주차로 반영됨)
  const { data: prog } = await supabaseAdmin
    .from("video_progress")
    .select("completed_at, updated_at")
    .eq("user_id", userId)
    .eq("video_id", videoId)
    .maybeSingle();

  let occurredAt = (prog?.completed_at ?? prog?.updated_at ?? new Date().toISOString()) as string;

  // 주차 과제라면 외부에 보낸 기간(월~토, 한국 시간 기준) 안으로 보정
  if (weekLabel && weekLinked) {
    const { start, end } = weekRangeForExternal(weekLabel);
    const t = new Date(occurredAt).getTime();
    const s = new Date(`${start}T00:00:00+09:00`).getTime();
    const e = new Date(`${end}T23:59:59+09:00`).getTime();
    if (Number.isNaN(t) || t < s || t > e) {
      occurredAt = new Date(`${end}T12:00:00+09:00`).toISOString();
    }
  }


  let anySent = false;
  let anyFailed = false;
  let anyAlready = false;

  for (const link of links) {
    // 이미 전송된 건은 건너뜀 (link_id + user_id 유니크)
    const { data: existing } = await supabaseAdmin
      .from("external_assignment_completions")
      .select("id, status")
      .eq("link_id", link.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (existing?.status === "sent") {
      anyAlready = true;
      continue;
    }

    const rowId = existing?.id ?? null;
    if (!rowId) {
      await supabaseAdmin.from("external_assignment_completions").insert({
        link_id: link.id,
        user_id: userId,
        video_id: videoId,
        status: "pending",
        occurred_at: occurredAt,
      });
    }

    try {
      await pushAssignmentComplete({
        external_id: link.external_id,
        student_id: student.external_id,
        assignment_type: link.assignment_type,
        status: COMPLETED_STATUS,
        memo,
        occurred_at: occurredAt,
        branch: (student as any).branch ?? null,
      });

      await supabaseAdmin
        .from("external_assignment_completions")
        .update({
          status: "sent",
          remote_status: COMPLETED_STATUS,
          error_message: null,
          sent_at: new Date().toISOString(),
        })
        .eq("link_id", link.id)
        .eq("user_id", userId);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[external-assignment] complete push failed", message);
      await supabaseAdmin
        .from("external_assignment_completions")
        .update({ status: "failed", error_message: message.slice(0, 500) })
        .eq("link_id", link.id)
        .eq("user_id", userId);
    }
  }
}
