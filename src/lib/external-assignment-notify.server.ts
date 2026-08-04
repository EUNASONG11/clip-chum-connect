/**
 * 영상 시청 완료 → 외부 "과제 점검" 완료 통보 (서버 전용, best-effort).
 * 실패해도 학생의 진도 저장을 막지 않도록 호출부에서 try/catch 합니다.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isExternalAssignmentConfigured, pushAssignmentComplete } from "./external-assignment.server";

const COMPLETED_STATUS = "review_completed";

export async function notifyVideoCompletion(userId: string, videoId: string): Promise<void> {
  if (!isExternalAssignmentConfigured()) return;

  const { data: video } = await supabaseAdmin
    .from("videos")
    .select("id, class_id, title")
    .eq("id", videoId)
    .maybeSingle();
  if (!video?.class_id) return;

  // 외부 시스템이 아는 학생 식별자 (마스터 students.id)
  const { data: student } = await supabaseAdmin
    .from("external_students")
    .select("external_id")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (!student?.external_id) return;

  const { data: links } = await supabaseAdmin
    .from("external_assignment_links")
    .select("id, external_id, assignment_type")
    .eq("class_id", video.class_id)
    .is("deleted_at", null);
  if (!links || links.length === 0) return;

  const occurredAt = new Date().toISOString();

  for (const link of links) {
    // 이미 전송된 건은 건너뜀 (link_id + user_id 유니크)
    const { data: existing } = await supabaseAdmin
      .from("external_assignment_completions")
      .select("id, status")
      .eq("link_id", link.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (existing?.status === "sent") continue;

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
        memo: `이러닝: "${video.title}" 시청 완료`,
        occurred_at: occurredAt,
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
