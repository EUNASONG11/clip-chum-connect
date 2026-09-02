-- 1) 역할 값 추가
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'branch_admin';

-- 2) 교육원 관리자의 담당 교육원 조회 함수 (enum 리터럴 대신 text 비교)
CREATE OR REPLACE FUNCTION public.branch_admin_branch(_uid uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT i.branch
  FROM public.instructors i
  WHERE i.auth_user_id = _uid
    AND i.is_active = true
    AND i.branch IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = _uid
        AND ur.role::text = 'branch_admin'
        AND ur.deleted_at IS NULL
    )
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.branch_admin_branch(uuid) TO authenticated;

-- 3) 접근 판정 함수에 교육원 관리자 규칙 추가
CREATE OR REPLACE FUNCTION public.instructor_can_access_class(_uid uuid, _class_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  select
    exists (
      select 1 from public.instructors i
      where i.auth_user_id = _uid and i.all_branches = true and i.is_active = true
    )
    or (
      _class_id is not null and (
        exists (select 1 from public.classes c where c.id = _class_id and c.created_by = _uid)
        or exists (
          select 1 from public.class_instructors ci
          where ci.class_id = _class_id
            and ci.instructor_user_id = _uid
            and ci.deleted_at is null
        )
        or exists (
          select 1 from public.classes c
          where c.id = _class_id
            and c.branch is not null
            and c.branch = public.branch_admin_branch(_uid)
        )
      )
    )
$$;

-- 4) videos 쓰기 정책을 공통 판정 함수로 정리
DROP POLICY IF EXISTS "Instructors can insert videos for own classes" ON public.videos;
CREATE POLICY "Instructors can insert videos for own classes"
ON public.videos FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'instructor'::app_role)
  AND (class_id IS NULL OR public.instructor_can_access_class(auth.uid(), class_id))
);

DROP POLICY IF EXISTS "Instructors can update videos for own classes" ON public.videos;
CREATE POLICY "Instructors can update videos for own classes"
ON public.videos FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(), 'instructor'::app_role)
  AND (created_by = auth.uid() OR public.instructor_can_access_class(auth.uid(), class_id))
)
WITH CHECK (
  has_role(auth.uid(), 'instructor'::app_role)
  AND (created_by = auth.uid() OR public.instructor_can_access_class(auth.uid(), class_id))
);

DROP POLICY IF EXISTS "Instructors can delete videos for own classes" ON public.videos;
CREATE POLICY "Instructors can delete videos for own classes"
ON public.videos FOR DELETE TO authenticated
USING (
  has_role(auth.uid(), 'instructor'::app_role)
  AND (created_by = auth.uid() OR public.instructor_can_access_class(auth.uid(), class_id))
);

-- 5) 배정 이력 / 문자 이력도 동일 기준으로 정리
DROP POLICY IF EXISTS "instructor can read assigned class history" ON public.class_enrollment_history;
CREATE POLICY "instructor can read assigned class history"
ON public.class_enrollment_history FOR SELECT TO authenticated
USING (public.instructor_can_access_class(auth.uid(), class_id));

DROP POLICY IF EXISTS "Instructors can view sms logs of their classes" ON public.sms_logs;
CREATE POLICY "Instructors can view sms logs of their classes"
ON public.sms_logs FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'instructor'::app_role)
  AND public.instructor_can_access_class(auth.uid(), class_id)
);

-- 6) 교육원 관리자는 자기 교육원 강사 명부 / 학생 정보 조회 가능
CREATE POLICY "Branch admins read own branch instructors"
ON public.instructors FOR SELECT TO authenticated
USING (branch IS NOT NULL AND branch = public.branch_admin_branch(auth.uid()));

CREATE POLICY "Branch admins read own branch students"
ON public.external_students FOR SELECT TO authenticated
USING (branch IS NOT NULL AND branch = public.branch_admin_branch(auth.uid()));