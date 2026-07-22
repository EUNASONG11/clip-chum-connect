-- Mirror table for students synced from master Supabase project
CREATE TABLE public.external_students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id uuid NOT NULL UNIQUE,
  name text NOT NULL,
  phone text,
  school text,
  grade text,
  class_time text,
  enrollment_status text,
  is_deleted boolean NOT NULL DEFAULT false,
  auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.external_students TO authenticated;
GRANT ALL ON public.external_students TO service_role;

ALTER TABLE public.external_students ENABLE ROW LEVEL SECURITY;

-- Only admins may read the mirror table from the client
CREATE POLICY "Admins read external_students"
ON public.external_students FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_external_students_updated_at
BEFORE UPDATE ON public.external_students
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_external_students_auth_user_id ON public.external_students(auth_user_id);
CREATE INDEX idx_external_students_phone ON public.external_students(phone);