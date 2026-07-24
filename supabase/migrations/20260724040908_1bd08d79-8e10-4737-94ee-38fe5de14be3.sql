
CREATE TABLE public.class_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX class_folders_class_id_idx ON public.class_folders(class_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.class_folders TO authenticated;
GRANT ALL ON public.class_folders TO service_role;

ALTER TABLE public.class_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage class folders"
  ON public.class_folders FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Instructors manage class folders"
  ON public.class_folders FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'instructor'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'instructor'::app_role));

CREATE POLICY "Students view class folders"
  ON public.class_folders FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.class_students cs
    WHERE cs.class_id = class_folders.class_id AND cs.user_id = auth.uid()
  ));

CREATE TRIGGER class_folders_updated_at
  BEFORE UPDATE ON public.class_folders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.videos
  ADD COLUMN folder_id uuid REFERENCES public.class_folders(id) ON DELETE SET NULL;

CREATE INDEX videos_folder_id_idx ON public.videos(folder_id);
