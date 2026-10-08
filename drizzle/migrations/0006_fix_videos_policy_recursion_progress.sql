CREATE OR REPLACE FUNCTION public.has_video_progress(_user_id uuid, _video_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.video_progress vp WHERE vp.video_id = _video_id AND vp.user_id = _user_id)
$$;

DROP POLICY IF EXISTS "Students view published videos in their classes" ON public.videos;
CREATE POLICY "Students view published videos in their classes" ON public.videos
FOR SELECT TO authenticated USING (
  has_role(auth.uid(), 'student'::app_role) AND is_published = true AND status = 'ready'
  AND class_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM class_students cs WHERE cs.class_id = videos.class_id AND cs.user_id = auth.uid() AND cs.deleted_at IS NULL)
  AND NOT public.is_video_excluded_for(auth.uid(), videos.id)
  AND (created_at >= COALESCE(student_video_start_at(auth.uid(), class_id), '-infinity'::timestamptz)
       OR public.has_video_progress(auth.uid(), videos.id))
);