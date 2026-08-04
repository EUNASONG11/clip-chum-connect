ALTER TABLE public.class_categories ADD COLUMN IF NOT EXISTS cohort text;
CREATE INDEX IF NOT EXISTS class_categories_cohort_idx ON public.class_categories (cohort) WHERE deleted_at IS NULL;