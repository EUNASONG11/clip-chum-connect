DROP TRIGGER IF EXISTS class_students_history_ins ON public.class_students;
DROP TRIGGER IF EXISTS class_students_history_del ON public.class_students;

DELETE FROM public.class_enrollment_history a
USING public.class_enrollment_history b
WHERE a.ctid > b.ctid
  AND a.class_id = b.class_id
  AND a.user_id = b.user_id
  AND a.action = b.action
  AND a.created_at = b.created_at;