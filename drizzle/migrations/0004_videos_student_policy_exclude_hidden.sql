DROP POLICY "Students view published videos in their classes" ON public.videos;

CREATE POLICY "Students view published videos in their classes"
ON public.videos
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'student'::app_role)
  AND is_published = true
  AND status = 'ready'
  AND class_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.class_students cs
    WHERE cs.class_id = videos.class_id
      AND cs.user_id = auth.uid()
      AND cs.deleted_at IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.video_student_exclusions x
    WHERE x.video_id = videos.id
      AND x.user_id = auth.uid()
      AND x.deleted_at IS NULL
  )
  AND (
    created_at >= COALESCE(public.student_video_start_at(auth.uid(), class_id), '-infinity'::timestamptz)
    OR EXISTS (
      SELECT 1 FROM public.video_progress vp
      WHERE vp.video_id = videos.id AND vp.user_id = auth.uid()
    )
  )
);