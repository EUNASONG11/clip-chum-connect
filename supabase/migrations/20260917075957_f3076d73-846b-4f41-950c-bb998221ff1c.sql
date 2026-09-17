UPDATE public.video_progress
SET watched_ratio = 1
WHERE is_completed = true
  AND watched_ratio < 1;