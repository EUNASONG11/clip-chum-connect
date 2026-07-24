ALTER TABLE public.videos
  ADD COLUMN IF NOT EXISTS allow_seek boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS max_playback_rate numeric NOT NULL DEFAULT 2.0;
ALTER TABLE public.videos
  ADD CONSTRAINT videos_max_playback_rate_check CHECK (max_playback_rate >= 0.5 AND max_playback_rate <= 4.0);