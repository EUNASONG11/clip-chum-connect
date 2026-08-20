UPDATE public.external_students s
SET enrollment_status = '재원'
WHERE s.is_deleted = false
  AND (s.enrollment_status IS NULL OR s.enrollment_status = '휴원')
  AND EXISTS (
    SELECT 1 FROM public.instructors i
    WHERE regexp_replace(i.phone, '[^0-9]', '', 'g') = s.phone
      AND i.name = s.name
  );