ALTER TABLE public.external_students ADD COLUMN IF NOT EXISTS branch text;
CREATE INDEX IF NOT EXISTS external_students_branch_idx ON public.external_students(branch);