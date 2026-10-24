-- 학생 화면 정렬(폴더 순서 → 영상 sort_order 오름차순 → created_at 내림차순)과 잠금 기준을 정확히 일치시킴
CREATE OR REPLACE FUNCTION public.student_video_locked(_user_id uuid, _video_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $function$
  WITH v AS (
    SELECT vd.class_id, vd.sort_order, vd.created_at, vd.id,
           COALESCE(f.sort_order, 9999) AS folder_sort
    FROM public.videos vd
    LEFT JOIN public.class_folders f ON f.id = vd.folder_id AND f.deleted_at IS NULL
    WHERE vd.id = _video_id AND vd.deleted_at IS NULL
  ),
  cs AS (
    SELECT c.progress_start_video_id
    FROM public.class_students c
    WHERE c.user_id = _user_id AND c.deleted_at IS NULL
      AND c.class_id = (SELECT class_id FROM v)
    LIMIT 1
  ),
  sv AS (
    SELECT svd.sort_order, svd.created_at, svd.id,
           COALESCE(sf.sort_order, 9999) AS folder_sort
    FROM public.videos svd
    LEFT JOIN public.class_folders sf ON sf.id = svd.folder_id AND sf.deleted_at IS NULL
    WHERE svd.id = (SELECT progress_start_video_id FROM cs)
      AND svd.deleted_at IS NULL
  )
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM v) THEN false
    WHEN EXISTS (SELECT 1 FROM sv) THEN
      (SELECT (v.folder_sort, v.sort_order) < (sv.folder_sort, sv.sort_order)
         OR ((v.folder_sort, v.sort_order) = (sv.folder_sort, sv.sort_order) AND v.created_at > sv.created_at)
         OR ((v.folder_sort, v.sort_order) = (sv.folder_sort, sv.sort_order) AND v.created_at = sv.created_at AND v.id < sv.id)
       FROM v, sv)
    WHEN (SELECT progress_start_video_id FROM cs) IS NOT NULL THEN false
    ELSE
      (SELECT v.created_at < COALESCE(public.student_video_start_at(_user_id, v.class_id), '-infinity'::timestamptz) FROM v)
  END
$function$;

REVOKE EXECUTE ON FUNCTION public.student_video_locked(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_video_locked(uuid, uuid) TO authenticated, service_role;