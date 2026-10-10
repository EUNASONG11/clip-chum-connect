ALTER TABLE public.external_students
  ADD COLUMN phone_manually_set boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.external_students.phone_manually_set IS '관리자가 앱에서 직접 전화번호를 수정한 경우 true. 마스터 동기화 웹훅이 phone/parent_phone을 덮어쓰지 않도록 보호한다.';