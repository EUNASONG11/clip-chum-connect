ALTER TABLE public.classes ADD COLUMN class_type TEXT;
COMMENT ON COLUMN public.classes.class_type IS '수강반 유형: 정규 | 내신 (NULL = 미지정)';
ALTER TABLE public.classes ADD CONSTRAINT classes_class_type_check CHECK (class_type IS NULL OR class_type IN ('정규', '내신')) NOT VALID;