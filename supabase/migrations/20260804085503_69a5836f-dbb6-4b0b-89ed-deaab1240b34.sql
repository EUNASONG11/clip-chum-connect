ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS branch text;
COMMENT ON COLUMN public.classes.branch IS 'NULL = 모든 교육원 공개, 값이 있으면 해당 교육원 전용';