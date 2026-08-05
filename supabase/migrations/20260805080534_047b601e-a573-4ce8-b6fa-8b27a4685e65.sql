CREATE OR REPLACE FUNCTION public.is_video_class_instructor(_user_id uuid, _video_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.videos v
    LEFT JOIN public.classes c ON c.id = v.class_id
    WHERE v.id = _video_id
      AND (
        c.created_by = _user_id
        OR EXISTS (
          SELECT 1 FROM public.class_instructors ci
          WHERE ci.class_id = v.class_id
            AND ci.instructor_user_id = _user_id
            AND ci.deleted_at IS NULL
        )
      )
  )
$$;

DROP POLICY IF EXISTS "View comments on accessible videos" ON public.comments;

CREATE POLICY "View own comments or as class instructor"
ON public.comments FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR public.is_video_class_instructor(auth.uid(), video_id)
);