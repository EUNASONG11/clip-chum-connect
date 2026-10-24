-- 잠금 판정을 업로드 시각 기준으로 되돌림 (순서 기준 분기 제거)
-- progress_start_video_id 칸과 값은 다음 수정에 사용하므로 유지
CREATE OR REPLACE FUNCTION public.student_video_locked(_user_id uuid, _video_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.videos v
    WHERE v.id = _video_id AND v.deleted_at IS NULL
      AND v.created_at < COALESCE(public.student_video_start_at(_user_id, v.class_id), '-infinity'::timestamptz)
  )
$function$;

REVOKE EXECUTE ON FUNCTION public.student_video_locked(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_video_locked(uuid, uuid) TO authenticated, service_role;