ALTER TABLE public.external_assignment_links
  ADD COLUMN IF NOT EXISTS video_id uuid REFERENCES public.videos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS external_assignment_links_video_id_idx
  ON public.external_assignment_links (video_id) WHERE deleted_at IS NULL;