ALTER TABLE public.video_progress
  ADD COLUMN IF NOT EXISTS watched_seconds integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS seek_attempts integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.video_seek_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  video_id uuid NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  from_seconds integer NOT NULL DEFAULT 0,
  to_seconds integer NOT NULL DEFAULT 0,
  blocked boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS video_seek_events_user_video_idx
  ON public.video_seek_events (user_id, video_id, created_at DESC);

GRANT SELECT, INSERT ON public.video_seek_events TO authenticated;
GRANT ALL ON public.video_seek_events TO service_role;

ALTER TABLE public.video_seek_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_insert_seek_events" ON public.video_seek_events
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "own_select_seek_events" ON public.video_seek_events
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "admin_select_seek_events" ON public.video_seek_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "instructor_select_seek_events" ON public.video_seek_events
  FOR SELECT TO authenticated
  USING (public.is_video_class_instructor(auth.uid(), video_id));