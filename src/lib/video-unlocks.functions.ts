import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { UnlockSnapshot } from "@/lib/video-unlock-model";

const scope = z.object({ classId: z.string().uuid(), userIds: z.array(z.string().uuid()).max(2000).optional(), videoIds: z.array(z.string().uuid()).max(2000).optional() });

export const getVideoUnlockStates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => scope.parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("video_student_access_states", {
      _class_id: data.classId, _user_ids: data.userIds, _video_ids: data.videoIds,
    });
    if (error) throw new Error(error.message);
    return result as unknown as UnlockSnapshot;
  });

export const setVideoUnlocks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => scope.extend({ userIds: z.array(z.string().uuid()).min(1).max(2000), videoIds: z.array(z.string().uuid()).min(1).max(2000), unlock: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("set_video_student_unlocks", {
      _class_id: data.classId, _user_ids: data.userIds, _video_ids: data.videoIds, _unlock: data.unlock,
    });
    if (error) throw new Error(error.message);
    return result as unknown as { affected: number; excluded_count: number };
  });