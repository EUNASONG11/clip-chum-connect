CREATE OR REPLACE FUNCTION public.student_video_start_at(_user_id uuid, _class_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT cs.progress_start_at FROM public.class_students cs
      WHERE cs.class_id = _class_id AND cs.user_id = _user_id AND cs.deleted_at IS NULL
      LIMIT 1),
    (SELECT max(h.created_at) FROM public.class_enrollment_history h
      WHERE h.class_id = _class_id AND h.user_id = _user_id AND h.action = 'added')
  )
$$;

REVOKE ALL ON FUNCTION public.student_video_start_at(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.student_video_start_at(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.student_video_start_at(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Students view published videos in their classes" ON public.videos;
CREATE POLICY "Students view published videos in their classes"
ON public.videos FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'student'::app_role)
  AND is_published = true
  AND status = 'ready'
  AND class_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.class_students cs
    WHERE cs.class_id = videos.class_id AND cs.user_id = auth.uid() AND cs.deleted_at IS NULL
  )
  AND (
    videos.created_at >= COALESCE(public.student_video_start_at(auth.uid(), videos.class_id), '-infinity'::timestamptz)
    OR EXISTS (
      SELECT 1 FROM public.video_progress vp
      WHERE vp.video_id = videos.id AND vp.user_id = auth.uid()
    )
  )
);

CREATE OR REPLACE FUNCTION public.can_access_video(_user_id uuid, _video_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.videos v
    WHERE v.id = _video_id
      AND v.deleted_at IS NULL
      AND (
        public.has_role(_user_id, 'admin'::app_role)
        OR public.has_role(_user_id, 'instructor'::app_role)
        OR (
          public.has_role(_user_id, 'student'::app_role)
          AND v.is_published = true
          AND v.status = 'ready'
          AND v.class_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.class_students cs
            WHERE cs.class_id = v.class_id
              AND cs.user_id = _user_id
              AND cs.deleted_at IS NULL
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.video_student_exclusions x
            WHERE x.video_id = v.id
              AND x.user_id = _user_id
              AND x.deleted_at IS NULL
          )
          AND (
            v.created_at >= COALESCE(public.student_video_start_at(_user_id, v.class_id), '-infinity'::timestamptz)
            OR EXISTS (
              SELECT 1 FROM public.video_progress vp
              WHERE vp.video_id = v.id AND vp.user_id = _user_id
            )
          )
        )
      )
  )
$$;