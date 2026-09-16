ALTER TABLE public.videos
  ADD COLUMN IF NOT EXISTS upload_stalled_ms integer,
  ADD COLUMN IF NOT EXISTS upload_retry_count integer;