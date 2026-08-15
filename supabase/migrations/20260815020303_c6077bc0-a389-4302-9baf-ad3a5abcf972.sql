ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS week_label text;
ALTER TABLE public.external_assignment_links ADD COLUMN IF NOT EXISTS week_label text;
CREATE INDEX IF NOT EXISTS idx_videos_class_week ON public.videos (class_id, week_label) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_eal_class_week ON public.external_assignment_links (class_id, week_label) WHERE deleted_at IS NULL;