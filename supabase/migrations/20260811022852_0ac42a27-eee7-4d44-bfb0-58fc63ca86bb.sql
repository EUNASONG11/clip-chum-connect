ALTER TABLE public.external_students
  ADD COLUMN IF NOT EXISTS is_local boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS external_students_is_local_idx ON public.external_students (is_local);