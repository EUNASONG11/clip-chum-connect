ALTER TABLE public.instructors ADD COLUMN IF NOT EXISTS cohorts text[] NOT NULL DEFAULT '{}';
UPDATE public.instructors SET cohorts = ARRAY[cohort] WHERE cohort IS NOT NULL AND cohort <> '' AND cardinality(cohorts) = 0;
CREATE INDEX IF NOT EXISTS instructors_cohorts_idx ON public.instructors USING GIN (cohorts);