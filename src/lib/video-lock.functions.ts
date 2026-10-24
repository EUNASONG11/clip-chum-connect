import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { compareOrderKeys, orderKeyOf } from "@/lib/video-order";
import { z } from "zod";

// 학생이 수강반 배정 이전 영상이라 시청이 막혔는지 확인
// 시작 영상이 id로 설정돼 있으면 화면 표시 순서(폴더 순서 → 폴더 안 영상 순서) 기준,
// 아니면 기존처럼 배정/시작 시각 기준
export const getVideoLockStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ videoId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: v } = await supabaseAdmin
      .from("videos")
      .select("id, class_id, created_at, is_published, status, folder_id, sort_order")
      .eq("id", data.videoId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!v || !v.class_id || !v.is_published) return { locked: false };
    const { data: enrolled } = await supabaseAdmin
      .from("class_students")
      .select("user_id, progress_start_video_id")
      .eq("class_id", v.class_id)
      .eq("user_id", context.userId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!enrolled) return { locked: false };
    const { data: prog } = await supabaseAdmin
      .from("video_progress")
      .select("video_id")
      .eq("user_id", context.userId)
      .eq("video_id", v.id)
      .maybeSingle();
    if (prog) return { locked: false };

    const startVideoId = (enrolled as any).progress_start_video_id as string | null;
    if (startVideoId) {
      const [{ data: sv }, { data: folderRows }] = await Promise.all([
        supabaseAdmin
          .from("videos")
          .select("id, folder_id, sort_order, created_at")
          .eq("id", startVideoId)
          .is("deleted_at", null)
          .maybeSingle(),
        supabaseAdmin
          .from("class_folders")
          .select("id, sort_order")
          .eq("class_id", v.class_id)
          .is("deleted_at", null),
      ]);
      if (sv) {
        const folderSortMap = new Map(
          (folderRows ?? []).map((f: any) => [f.id as string, Number(f.sort_order ?? 9999)]),
        );
        return { locked: compareOrderKeys(orderKeyOf(v, folderSortMap), orderKeyOf(sv, folderSortMap)) < 0 };
      }
      // 시작 영상이 삭제됐으면 잠금 없음
      return { locked: false };
    }

    const { data: s } = await supabaseAdmin.rpc("student_video_start_at", {
      _user_id: context.userId,
      _class_id: v.class_id,
    });
    if (!s) return { locked: false };
    return { locked: new Date(v.created_at).getTime() < new Date(s as string).getTime() };
  });
