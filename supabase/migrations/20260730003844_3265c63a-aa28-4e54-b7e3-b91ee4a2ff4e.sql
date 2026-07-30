-- classes: students must have approved student role
DROP POLICY IF EXISTS "Students view assigned classes" ON public.classes;
CREATE POLICY "Students view assigned classes"
ON public.classes FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'student'::app_role)
  AND EXISTS (
    SELECT 1 FROM public.class_students cs
    WHERE cs.class_id = classes.id AND cs.user_id = auth.uid() AND cs.deleted_at IS NULL
  )
);

-- videos
DROP POLICY IF EXISTS "Students view published videos in their classes" ON public.videos;
CREATE POLICY "Students view published videos in their classes"
ON public.videos FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'student'::app_role)
  AND is_published = true
  AND status = 'ready'
  AND class_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.class_students cs
    WHERE cs.class_id = videos.class_id AND cs.user_id = auth.uid() AND cs.deleted_at IS NULL
  )
);

-- class_folders
DROP POLICY IF EXISTS "Students view class folders" ON public.class_folders;
CREATE POLICY "Students view class folders"
ON public.class_folders FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'student'::app_role)
  AND EXISTS (
    SELECT 1 FROM public.class_students cs
    WHERE cs.class_id = class_folders.class_id AND cs.user_id = auth.uid() AND cs.deleted_at IS NULL
  )
);

-- class_students own memberships
DROP POLICY IF EXISTS "Students view own memberships" ON public.class_students;
CREATE POLICY "Students view own memberships"
ON public.class_students FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  AND public.has_role(auth.uid(), 'student'::app_role)
);

-- can_access_video: student branch requires approved student role
CREATE OR REPLACE FUNCTION public.can_access_video(_user_id uuid, _video_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
        )
      )
  )
$function$;