REVOKE ALL ON FUNCTION public.class_student_stats_agg(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.class_student_stats_agg(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.class_stats_agg(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.class_stats_agg(uuid[]) TO service_role;

REVOKE ALL ON FUNCTION public.overview_stats_agg(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.overview_stats_agg(uuid[]) TO service_role;

REVOKE ALL ON FUNCTION public.class_sms_recent_batches(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.class_sms_recent_batches(uuid, integer) TO service_role;