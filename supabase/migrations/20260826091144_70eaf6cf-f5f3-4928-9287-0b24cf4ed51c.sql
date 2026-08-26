-- 서버(service_role) 전용 집계 함수: 클라이언트 직접 호출 차단
revoke all on function public.class_stats_agg(uuid[]) from anon, authenticated;
revoke all on function public.class_student_stats_agg(uuid) from anon, authenticated;
revoke all on function public.overview_stats_agg(uuid[]) from anon, authenticated;
revoke all on function public.class_sms_recent_batches(uuid, integer) from anon, authenticated;
grant execute on function public.class_stats_agg(uuid[]) to service_role;
grant execute on function public.class_student_stats_agg(uuid) to service_role;
grant execute on function public.overview_stats_agg(uuid[]) to service_role;
grant execute on function public.class_sms_recent_batches(uuid, integer) to service_role;

-- 권한 판정 함수: 비로그인 호출 차단 (RLS 정책용으로 authenticated 유지)
revoke all on function public.has_role(uuid, app_role) from anon;
revoke all on function public.can_access_video(uuid, uuid) from anon;
revoke all on function public.instructor_can_access_class(uuid, uuid) from anon;
revoke all on function public.is_video_class_instructor(uuid, uuid) from anon;

-- 트리거 전용 함수
revoke all on function public.log_class_enrollment_change() from anon, authenticated;
revoke all on function public.update_updated_at_column() from anon, authenticated;
