UPDATE public.external_students
SET auth_user_id = 'dba6b4ac-5016-47f9-838c-70d03f04fcf4',
    enrollment_status = '재원',
    is_deleted = false,
    updated_at = now()
WHERE id = 'c1f7cca2-d600-43b0-8919-356710d9e3dc';

INSERT INTO public.user_roles (user_id, role)
SELECT 'dba6b4ac-5016-47f9-838c-70d03f04fcf4'::uuid, 'student'::public.app_role
WHERE NOT EXISTS (
  SELECT 1
  FROM public.user_roles
  WHERE user_id = 'dba6b4ac-5016-47f9-838c-70d03f04fcf4'::uuid
    AND role = 'student'::public.app_role
    AND deleted_at IS NULL
);