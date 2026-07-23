
CREATE TABLE public.class_instructors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  instructor_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, instructor_user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.class_instructors TO authenticated;
GRANT ALL ON public.class_instructors TO service_role;

ALTER TABLE public.class_instructors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage class_instructors"
  ON public.class_instructors FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Instructors view own assignments"
  ON public.class_instructors FOR SELECT
  USING (instructor_user_id = auth.uid());

CREATE INDEX class_instructors_class_idx ON public.class_instructors(class_id);
CREATE INDEX class_instructors_user_idx ON public.class_instructors(instructor_user_id);

-- 강사가 배정받은 수강반을 조회할 수 있도록 SELECT 정책 추가
CREATE POLICY "Instructors view assigned classes"
  ON public.classes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.class_instructors ci
      WHERE ci.class_id = classes.id AND ci.instructor_user_id = auth.uid()
    )
  );
