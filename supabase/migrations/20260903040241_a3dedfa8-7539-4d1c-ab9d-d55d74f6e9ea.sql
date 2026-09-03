GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.branch_admin_branch(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_video(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.instructor_can_access_class(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_video_class_instructor(uuid, uuid) TO authenticated;