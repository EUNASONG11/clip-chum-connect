CREATE OR REPLACE FUNCTION public.has_video_progress(_user_id uuid, _video_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.video_progress vp
    WHERE vp.video_id = _video_id AND vp.user_id = _user_id
  )
$function$;

CREATE OR REPLACE FUNCTION public.is_video_excluded_for(_user_id uuid, _video_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.video_student_exclusions x
    WHERE x.video_id = _video_id AND x.user_id = _user_id AND x.deleted_at IS NULL
  )
$function$;

REVOKE EXECUTE ON FUNCTION public.has_video_progress(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_video_excluded_for(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_video_progress(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_video_excluded_for(uuid, uuid) TO authenticated, service_role;