ALTER TABLE public.videos
  ADD COLUMN IF NOT EXISTS rewatch_allow_seek boolean,
  ADD COLUMN IF NOT EXISTS rewatch_max_playback_rate numeric;