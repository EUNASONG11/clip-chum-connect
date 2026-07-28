
CREATE TABLE public.class_categories (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  color text,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.class_categories TO authenticated;
GRANT ALL ON public.class_categories TO service_role;

ALTER TABLE public.class_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view categories"
  ON public.class_categories FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage categories"
  ON public.class_categories FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Instructors manage categories"
  ON public.class_categories FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'instructor'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'instructor'::app_role));

CREATE TRIGGER update_class_categories_updated_at
  BEFORE UPDATE ON public.class_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.classes
  ADD COLUMN category_id uuid REFERENCES public.class_categories(id) ON DELETE SET NULL;

CREATE INDEX idx_classes_category_id ON public.classes(category_id);
