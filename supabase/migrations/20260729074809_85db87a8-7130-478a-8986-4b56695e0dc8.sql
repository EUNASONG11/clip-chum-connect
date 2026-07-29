ALTER TABLE public.external_students ADD COLUMN IF NOT EXISTS parent_phone text;
CREATE INDEX IF NOT EXISTS external_students_parent_phone_idx ON public.external_students(parent_phone);