import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// 내 진도 조회
export const getMyProgress = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ videoId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("video_progress")
      .select(
        "current_seconds, max_seconds, duration, watched_ratio, watched_seconds, seek_attempts, is_completed, completed_at, updated_at",
      )
      .eq("user_id", context.userId)
      .eq("video_id", data.videoId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row;
  });

// 건너뛰기 시도 로그 (차단 여부 포함) + 시도 횟수 누적
export const logSeekAttempt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        videoId: z.string().uuid(),
        fromSeconds: z.number().min(0).max(200000),
        toSeconds: z.number().min(0).max(200000),
        blocked: z.boolean(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("video_seek_events").insert({
      user_id: context.userId,
      video_id: data.videoId,
      from_seconds: Math.floor(data.fromSeconds),
      to_seconds: Math.floor(data.toSeconds),
      blocked: data.blocked,
    });
    if (error) throw new Error(error.message);

    const { data: prev } = await context.supabase
      .from("video_progress")
      .select("seek_attempts")
      .eq("user_id", context.userId)
      .eq("video_id", data.videoId)
      .maybeSingle();

    if (prev) {
      await context.supabase
        .from("video_progress")
        .update({ seek_attempts: Number(prev.seek_attempts ?? 0) + 1 })
        .eq("user_id", context.userId)
        .eq("video_id", data.videoId);
    } else {
      await context.supabase.from("video_progress").insert({
        user_id: context.userId,
        video_id: data.videoId,
        current_seconds: Math.floor(data.fromSeconds),
        max_seconds: Math.floor(data.fromSeconds),
        seek_attempts: 1,
      } as any);
    }
    return { ok: true };
  });


// 진도 upsert (서버에서 max_seconds 단조 증가, 완료 판정)
export const upsertMyProgress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        videoId: z.string().uuid(),
        currentSeconds: z.number().int().min(0),
        duration: z.number().int().min(0).nullable().optional(),
        endedEvent: z.boolean().optional(),
        // 마지막 전송 이후 실제로 재생된 시간(초). 되감아 다시 본 구간도 합산됨
        watchedDelta: z.number().min(0).max(600).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    // 영상의 완료 기준을 조회 (삭제되었거나 접근 불가한 영상이면 조용히 무시)
    const { data: video, error: videoErr } = await context.supabase
      .from("videos")
      .select("completion_ratio, duration, deleted_at")
      .eq("id", data.videoId)
      .maybeSingle();
    if (videoErr || !video || video.deleted_at) {
      return { watched_ratio: 0, is_completed: false, skipped: true };
    }
    const completionRatio = Number(video?.completion_ratio ?? 0.9);
    const duration = data.duration ?? video?.duration ?? null;


    // 기존 진도
    const { data: prev } = await context.supabase
      .from("video_progress")
      .select("max_seconds, is_completed, watched_seconds")
      .eq("user_id", context.userId)
      .eq("video_id", data.videoId)
      .maybeSingle();

    const prevMax = prev?.max_seconds ?? 0;
    // 서버 측 이중 차단: 이전 최대치 대비 tick 주기(~5s) + 여유 2s = 7s 초과분은 무시
    // 클라이언트가 이미 재생속도 기반으로 걸러내지만, 조작 방지용 서버 캡
    const cappedCurrent = Math.min(data.currentSeconds, prevMax + 7);
    const nextMax = Math.max(prevMax, cappedCurrent);
    const ratio = duration && duration > 0 ? Math.min(1, nextMax / duration) : 0;
    const alreadyCompleted = prev?.is_completed ?? false;
    // 완료 기준 판정 시 0.5%p 허용 오차 (예: 기준 100% → 99.5% 이상이면 완료 처리)
    const effectiveRatio = Math.max(0, completionRatio - 0.005);
    const nowCompleted = alreadyCompleted || !!data.endedEvent || ratio >= effectiveRatio;

    // 실제 시청 시간 누적 (1회 전송당 최대 30초까지만 인정)
    const prevWatched = Number(prev?.watched_seconds ?? 0);
    const nextWatched = prevWatched + Math.min(30, Math.max(0, Math.floor(data.watchedDelta ?? 0)));

    const patch = {
      user_id: context.userId,
      video_id: data.videoId,
      current_seconds: data.currentSeconds,
      max_seconds: nextMax,
      duration: duration ?? null,
      watched_ratio: ratio,
      watched_seconds: nextWatched,
      is_completed: nowCompleted,
      completed_at: nowCompleted && !alreadyCompleted ? new Date().toISOString() : undefined,
      updated_at: new Date().toISOString(),
    };


    const { error } = await context.supabase
      .from("video_progress")
      .upsert(patch as any, { onConflict: "user_id,video_id" });
    if (error) throw new Error(error.message);

    // 신규 완료 시 외부 "과제 점검"에 완료 통보 (best-effort)
    if (nowCompleted && !alreadyCompleted) {
      try {
        const { notifyVideoCompletion } = await import("./external-assignment-notify.server");
        await notifyVideoCompletion(context.userId, data.videoId);
      } catch (e) {
        console.error("[external-assignment] notify skipped", e instanceof Error ? e.message : e);
      }
    }

    return { watched_ratio: ratio, is_completed: nowCompleted };
  });


// 최근 본 영상 (RLS로 접근 가능한 영상만)
export const listRecentlyWatched = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ limit: z.number().int().min(1).max(20).optional() }).parse(i))
  .handler(async ({ data, context }) => {
    const limit = data.limit ?? 5;
    const { data: rows, error } = await context.supabase
      .from("video_progress")
      .select(
        "video_id, current_seconds, watched_ratio, is_completed, updated_at, videos!inner(id, title, thumbnail_url, duration)",
      )
      .eq("user_id", context.userId)
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => ({
      video_id: r.video_id as string,
      current_seconds: r.current_seconds as number,
      watched_ratio: Number(r.watched_ratio),
      is_completed: r.is_completed as boolean,
      updated_at: r.updated_at as string,
      title: r.videos?.title as string,
      thumbnail_url: r.videos?.thumbnail_url as string | null,
      duration: r.videos?.duration as number | null,
    }));
  });
