revoke all on function public.has_role(uuid, app_role) from public;
revoke all on function public.can_access_video(uuid, uuid) from public;
revoke all on function public.instructor_can_access_class(uuid, uuid) from public;
revoke all on function public.is_video_class_instructor(uuid, uuid) from public;
grant execute on function public.has_role(uuid, app_role) to authenticated, service_role;
grant execute on function public.can_access_video(uuid, uuid) to authenticated, service_role;
grant execute on function public.instructor_can_access_class(uuid, uuid) to authenticated, service_role;
grant execute on function public.is_video_class_instructor(uuid, uuid) to authenticated, service_role;
