ALTER TABLE public.videos
  ADD COLUMN IF NOT EXISTS upload_started_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS upload_duration_ms integer,
  ADD COLUMN IF NOT EXISTS file_size_bytes bigint;