import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// 영상의 수강반에 대한 관리자/강사 권한 확인 후 class_id 반환
async function assertVideoStaffAccess(context: any, videoId: string): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: video, error } = await supabaseAdmin
    .from("videos")
    .select("id, class_id")
    .eq("id", videoId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!video) throw new Error("영상을 찾을 수 없습니다.");
  const classId = (video as any).class_id as string | null;
  if (!classId) throw new Error("수강반에 속하지 않은 영상입니다.");

  const { data: admin } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (admin) return classId;

  const { data: canAccess } = await context.supabase.rpc("instructor_can_access_class", {
    _uid: context.userId,
    _class_id: classId,
  });
  if (!canAccess) throw new Error("해당 수강반에 대한 권한이 없습니다.");
  return classId;
}

// 특정 학생에게 영상 숨기기/다시 보이기
export const setVideoExclusion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        videoId: z.string().uuid(),
        userId: z.string().uuid(),
        hidden: z.boolean(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertVideoStaffAccess(context, data.videoId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.hidden) {
      const { data: existing } = await supabaseAdmin
        .from("video_student_exclusions")
        .select("id, deleted_at")
        .eq("video_id", data.videoId)
        .eq("user_id", data.userId)
        .maybeSingle();
      if (existing) {
        if ((existing as any).deleted_at) {
          const { error } = await supabaseAdmin
            .from("video_student_exclusions")
            .update({ deleted_at: null, created_by: context.userId })
            .eq("id", (existing as any).id);
          if (error) throw new Error(error.message);
        }
      } else {
        const { error } = await supabaseAdmin
          .from("video_student_exclusions")
          .insert({
            video_id: data.videoId,
            user_id: data.userId,
            created_by: context.userId,
          });
        if (error) throw new Error(error.message);
      }
    } else {
      const { error } = await supabaseAdmin
        .from("video_student_exclusions")
        .update({ deleted_at: new Date().toISOString() })
        .eq("video_id", data.videoId)
        .eq("user_id", data.userId)
        .is("deleted_at", null);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

// 영상별 숨김 학생 목록
export const listVideoExclusions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ videoId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertVideoStaffAccess(context, data.videoId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("video_student_exclusions")
      .select("user_id")
      .eq("video_id", data.videoId)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    return ((rows ?? []) as any[]).map((r) => r.user_id as string);
  });

// 영상이 속한 수강반의 배정 학생 목록 (숨김 관리 다이얼로그용)
export const listVideoClassStudents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ videoId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const classId = await assertVideoStaffAccess(context, data.videoId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: students, error } = await supabaseAdmin
      .from("class_students")
      .select("user_id")
      .eq("class_id", classId)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    const userIds = ((students ?? []) as any[]).map((s) => s.user_id as string);
    if (userIds.length === 0) return [];

    const { data: externals, error: eErr } = await supabaseAdmin
      .from("external_students")
      .select("auth_user_id, name, school, grade, branch")
      .in("auth_user_id", userIds)
      .eq("is_deleted", false);
    if (eErr) throw new Error(eErr.message);
    const nameMap = new Map(
      ((externals ?? []) as any[]).map((e) => [e.auth_user_id as string, e]),
    );

    const list = userIds.map((uid) => {
      const e: any = nameMap.get(uid);
      return {
        user_id: uid,
        name: (e?.name ?? "") as string,
        school: (e?.school ?? "") as string,
        grade: (e?.grade ?? "") as string,
        branch: (e?.branch ?? "") as string,
      };
    });
    list.sort((a, b) => a.name.localeCompare(b.name, "ko"));
    return list;
  });
