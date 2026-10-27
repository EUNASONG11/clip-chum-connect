CREATE OR REPLACE FUNCTION public.class_student_messaging_counts(_class_id uuid, _video_ids uuid[])
RETURNS TABLE(user_id uuid, eligible_total bigint, completed_count bigint, name text, phone text, parent_phone text, branch text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  WITH counts AS (
    SELECT t.user_id, count(*) AS eligible_total,
      count(*) FILTER (WHERE p.is_completed = true) AS completed_count
    FROM public.class_student_video_targets(_class_id, _video_ids) t
    LEFT JOIN public.video_progress p ON p.user_id = t.user_id AND p.video_id = t.video_id
    GROUP BY t.user_id
  )
  SELECT c.user_id, c.eligible_total, c.completed_count, e.name, e.phone, e.parent_phone, e.branch
  FROM counts c
  LEFT JOIN LATERAL (
    SELECT s.name, s.phone, s.parent_phone, s.branch
    FROM public.external_students s
    WHERE s.auth_user_id = c.user_id AND s.is_deleted = false
    ORDER BY s.id DESC
    LIMIT 1
  ) e ON true;
$function$;
REVOKE ALL ON FUNCTION public.class_student_messaging_counts(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.class_student_messaging_counts(uuid, uuid[]) TO service_role;
COMMENT ON FUNCTION public.class_student_messaging_counts(uuid, uuid[]) IS 'Messaging counts reuse class_student_video_targets; active external student contact uses greatest id, matching prior ordered-map selection among active rows. Service role only, caller must authorize class access.';