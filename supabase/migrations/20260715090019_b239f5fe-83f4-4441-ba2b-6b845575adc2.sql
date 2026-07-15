ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'vimeo';
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS external_video_id text;
ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS external_url text;
ALTER TABLE public.videos ALTER COLUMN vimeo_uri DROP NOT NULL;
ALTER TABLE public.videos ALTER COLUMN vimeo_video_id DROP NOT NULL;
ALTER TABLE public.videos ADD CONSTRAINT videos_source_check CHECK (source IN ('vimeo','youtube'));