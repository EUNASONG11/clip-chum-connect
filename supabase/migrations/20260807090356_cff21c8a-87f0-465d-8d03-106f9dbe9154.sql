ALTER TABLE public.instructors ADD COLUMN IF NOT EXISTS all_branches boolean NOT NULL DEFAULT false;
UPDATE public.instructors SET all_branches = true WHERE name = '장민애';