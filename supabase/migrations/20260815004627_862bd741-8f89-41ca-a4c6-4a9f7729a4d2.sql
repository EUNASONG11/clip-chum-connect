UPDATE public.video_progress vp
SET is_completed = true,
    completed_at = COALESCE(vp.completed_at, now()),
    updated_at = now()
FROM public.videos v
WHERE v.id = vp.video_id
  AND vp.is_completed = false
  AND vp.watched_ratio >= GREATEST(v.completion_ratio - 0.005, 0);