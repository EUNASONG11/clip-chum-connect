-- 새 배열 컬럼 추가(기본값 카드)
ALTER TABLE public.notices
  ADD COLUMN display_type_new text[] NOT NULL DEFAULT ARRAY['card'];

-- 기존 단일 텍스트 값을 하나짜리 배열로 복사
UPDATE public.notices
  SET display_type_new = ARRAY[display_type];

-- 기존 텍스트 컬럼 삭제
ALTER TABLE public.notices
  DROP COLUMN display_type;

-- 새 컬럼 이름을 원래 이름으로 변경
ALTER TABLE public.notices
  RENAME COLUMN display_type_new TO display_type;

-- 허용 값 제약 추가
ALTER TABLE public.notices
  ADD CONSTRAINT notices_display_type_check
  CHECK (display_type <@ ARRAY['main', 'card']::text[]);