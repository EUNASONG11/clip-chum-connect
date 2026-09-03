REVOKE EXECUTE ON FUNCTION public.branch_admin_branch(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.can_access_video(uuid, uuid) FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.instructor_can_access_class(uuid, uuid) FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_video_class_instructor(uuid, uuid) FROM PUBLIC, authenticated;