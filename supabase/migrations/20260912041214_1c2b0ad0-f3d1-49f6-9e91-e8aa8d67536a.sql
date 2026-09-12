ALTER TABLE public.external_students ADD COLUMN IF NOT EXISTS cohort text;
CREATE INDEX IF NOT EXISTS external_students_cohort_idx ON public.external_students (cohort);