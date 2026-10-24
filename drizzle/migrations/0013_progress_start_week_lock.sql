-- 1. 시작 주차 칸 추가 (기존 progress_start_at / progress_start_video_id 는 유지)
ALTER TABLE public.class_students ADD COLUMN progress_start_week text;
COMMENT ON COLUMN public.class_students.progress_start_week IS '학습 현황/시청 범위 시작 주차(YYYY-MM-W). 설정 시 주차 기준 잠금 적용, progress_start_at은 그 주 월요일 00:00(KST)';

-- 2. 잠금 판정: 시작 주차가 있으면 주차 기준(주차 없는 영상은 시작 주 월요일 이전 업로드면 잠금),
--    없으면 기존 업로드 시각 기준
CREATE OR REPLACE FUNCTION public.student_video_locked(_user_id uuid, _video_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $function$
  WITH v AS (
    SELECT vd.class_id, vd.created_at, vd.week_label
    FROM public.videos vd
    WHERE vd.id = _video_id AND vd.deleted_at IS NULL
  ),
  cs AS (
    SELECT c.progress_start_week, c.progress_start_at
    FROM public.class_students c
    WHERE c.user_id = _user_id AND c.deleted_at IS NULL
      AND c.class_id = (SELECT class_id FROM v)
    LIMIT 1
  )
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM v) THEN false
    WHEN (SELECT progress_start_week FROM cs) IS NOT NULL THEN
      CASE
        WHEN (SELECT week_label FROM v) ~ '^\d{4}-\d{2}-[1-5]$' THEN
          (SELECT (split_part(v.week_label, '-', 1)::int, split_part(v.week_label, '-', 2)::int, split_part(v.week_label, '-', 3)::int)
                < (split_part(cs.progress_start_week, '-', 1)::int, split_part(cs.progress_start_week, '-', 2)::int, split_part(cs.progress_start_week, '-', 3)::int)
           FROM v, cs)
        ELSE
          (SELECT v.created_at < COALESCE(cs.progress_start_at, '-infinity'::timestamptz) FROM v, cs)
      END
    ELSE
      (SELECT v.created_at < COALESCE(public.student_video_start_at(_user_id, v.class_id), '-infinity'::timestamptz) FROM v)
  END
$function$;

REVOKE EXECUTE ON FUNCTION public.student_video_locked(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_video_locked(uuid, uuid) TO authenticated, service_role;