
-- 1) classes
CREATE TABLE public.classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.classes TO authenticated;
GRANT ALL ON public.classes TO service_role;
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;

-- 2) class_students
CREATE TABLE public.class_students (
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (class_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.class_students TO authenticated;
GRANT ALL ON public.class_students TO service_role;
ALTER TABLE public.class_students ENABLE ROW LEVEL SECURITY;

-- 3) classes policies
CREATE POLICY "Admins manage classes" ON public.classes
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Students view assigned classes" ON public.classes
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.class_students cs
            WHERE cs.class_id = classes.id AND cs.user_id = auth.uid())
  );

CREATE TRIGGER classes_updated_at BEFORE UPDATE ON public.classes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4) class_students policies
CREATE POLICY "Admins manage class_students" ON public.class_students
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Students view own memberships" ON public.class_students
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- 5) videos 컬럼 추가
ALTER TABLE public.videos
  ADD COLUMN class_id uuid REFERENCES public.classes(id) ON DELETE SET NULL,
  ADD COLUMN is_published boolean NOT NULL DEFAULT false,
  ADD COLUMN sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN completion_ratio numeric NOT NULL DEFAULT 0.9;

-- 6) videos SELECT 정책 재구성
DROP POLICY IF EXISTS "Ready videos are publicly viewable" ON public.videos;

CREATE POLICY "Admins view all videos" ON public.videos
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Students view published videos in their classes" ON public.videos
  FOR SELECT TO authenticated
  USING (
    is_published = true
    AND status = 'ready'
    AND class_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.class_students cs
                WHERE cs.class_id = videos.class_id AND cs.user_id = auth.uid())
  );
