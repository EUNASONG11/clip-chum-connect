
CREATE POLICY "Instructors can insert videos for own classes"
ON public.videos FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'instructor'::app_role)
  AND (
    class_id IS NULL
    OR EXISTS (SELECT 1 FROM public.class_instructors ci WHERE ci.class_id = videos.class_id AND ci.instructor_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.classes c WHERE c.id = videos.class_id AND c.created_by = auth.uid())
  )
);

CREATE POLICY "Instructors can update videos for own classes"
ON public.videos FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'instructor'::app_role)
  AND (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM public.class_instructors ci WHERE ci.class_id = videos.class_id AND ci.instructor_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.classes c WHERE c.id = videos.class_id AND c.created_by = auth.uid())
  )
);

CREATE POLICY "Instructors can delete videos for own classes"
ON public.videos FOR DELETE TO authenticated
USING (
  public.has_role(auth.uid(), 'instructor'::app_role)
  AND (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM public.class_instructors ci WHERE ci.class_id = videos.class_id AND ci.instructor_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.classes c WHERE c.id = videos.class_id AND c.created_by = auth.uid())
  )
);

CREATE POLICY "Instructors view own class videos"
ON public.videos FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'instructor'::app_role)
);
