import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// 영상 존재 여부/공개 여부만 반환 (제목 등 다른 정보는 노출하지 않음)
export const getVideoAvailability = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ videoId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: v, error } = await supabaseAdmin
      .from("videos")
      .select("id, is_published")
      .eq("id", data.videoId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!v) return { exists: false, published: false };
    return { exists: true, published: v.is_published };
  });
