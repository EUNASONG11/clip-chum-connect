import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// 학생이 수강반 배정 이전 영상이라 시청이 막혔는지 확인
export const getVideoLockStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ videoId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: v } = await supabaseAdmin
      .from("videos")
      .select("id, class_id, created_at, is_published, status")
      .eq("id", data.videoId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!v || !v.class_id || !v.is_published) return { locked: false };
    const { data: enrolled } = await supabaseAdmin
      .from("class_students")
      .select("user_id")
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
    const { data: s } = await supabaseAdmin.rpc("student_video_start_at", {
      _user_id: context.userId,
      _class_id: v.class_id,
    });
    if (!s) return { locked: false };
    return { locked: new Date(v.created_at).getTime() < new Date(s as string).getTime() };
  });
