
-- 1) instructors 테이블
CREATE TABLE public.instructors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id uuid UNIQUE,
  name text NOT NULL,
  email text,
  phone text,
  branch text,
  hire_date date,
  department_id integer,
  team_id integer,
  is_team_leader boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_instructors_auth_user_id ON public.instructors(auth_user_id);
CREATE INDEX idx_instructors_phone ON public.instructors(phone);
CREATE INDEX idx_instructors_email ON public.instructors(email);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.instructors TO authenticated;
GRANT ALL ON public.instructors TO service_role;

ALTER TABLE public.instructors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage instructors"
  ON public.instructors
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Instructors read own row"
  ON public.instructors
  FOR SELECT
  TO authenticated
  USING (auth_user_id = auth.uid());

CREATE TRIGGER update_instructors_updated_at
  BEFORE UPDATE ON public.instructors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) external_students 에 있던 강사 데이터 이관
INSERT INTO public.instructors (external_id, name, phone, auth_user_id, is_active)
SELECT external_id, name, phone, auth_user_id, true
FROM public.external_students
WHERE enrollment_status = '강사'
ON CONFLICT (external_id) DO NOTHING;

-- 3) external_students 에서 강사 레코드 제거
DELETE FROM public.external_students WHERE enrollment_status = '강사';
