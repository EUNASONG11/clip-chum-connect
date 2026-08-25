REVOKE EXECUTE ON FUNCTION public.class_stats_agg(uuid[]) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.class_student_stats_agg(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.overview_stats_agg(uuid[]) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.class_sms_recent_batches(uuid, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.class_stats_agg(uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.class_student_stats_agg(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.overview_stats_agg(uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.class_sms_recent_batches(uuid, integer) TO service_role;