
CREATE TABLE public.class_enrollment_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('added','removed')),
  actor_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX class_enrollment_history_class_idx ON public.class_enrollment_history(class_id, created_at DESC);
CREATE INDEX class_enrollment_history_user_idx ON public.class_enrollment_history(user_id, created_at DESC);

GRANT SELECT ON public.class_enrollment_history TO authenticated;
GRANT ALL ON public.class_enrollment_history TO service_role;

ALTER TABLE public.class_enrollment_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can read all history"
  ON public.class_enrollment_history FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "instructor can read assigned class history"
  ON public.class_enrollment_history FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.classes c
      WHERE c.id = class_enrollment_history.class_id
        AND (c.created_by = auth.uid()
             OR EXISTS (SELECT 1 FROM public.class_instructors ci
                        WHERE ci.class_id = c.id AND ci.instructor_user_id = auth.uid()))
    )
  );

CREATE OR REPLACE FUNCTION public.log_class_enrollment_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.class_enrollment_history (class_id, user_id, action, actor_id)
    VALUES (NEW.class_id, NEW.user_id, 'added', auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.class_enrollment_history (class_id, user_id, action, actor_id)
    VALUES (OLD.class_id, OLD.user_id, 'removed', auth.uid());
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER class_students_history_ins
  AFTER INSERT ON public.class_students
  FOR EACH ROW EXECUTE FUNCTION public.log_class_enrollment_change();

CREATE TRIGGER class_students_history_del
  AFTER DELETE ON public.class_students
  FOR EACH ROW EXECUTE FUNCTION public.log_class_enrollment_change();

INSERT INTO public.class_enrollment_history (class_id, user_id, action, actor_id, created_at)
SELECT class_id, user_id, 'added', NULL, COALESCE(created_at, now())
FROM public.class_students;
