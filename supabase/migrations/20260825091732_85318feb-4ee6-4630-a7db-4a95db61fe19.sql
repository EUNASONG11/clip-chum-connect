-- 인덱스 보강
CREATE INDEX IF NOT EXISTS class_enrollment_history_class_user_added_idx
  ON public.class_enrollment_history (class_id, user_id, created_at DESC)
  WHERE action = 'added';

CREATE INDEX IF NOT EXISTS video_progress_video_user_idx
  ON public.video_progress (video_id, user_id)
  INCLUDE (is_completed, watched_ratio, updated_at);

CREATE INDEX IF NOT EXISTS external_students_auth_user_idx
  ON public.external_students (auth_user_id);

CREATE INDEX IF NOT EXISTS videos_class_created_idx
  ON public.videos (class_id, created_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS instructors_auth_user_idx
  ON public.instructors (auth_user_id);

-- 수강반별 통계: 상관 서브쿼리 → 집합 집계
CREATE OR REPLACE FUNCTION public.class_stats_agg(_class_ids uuid[])
 RETURNS TABLE(class_id uuid, video_count integer, student_count integer, total_cells integer, completed_cells integer, sum_ratio numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH enroll AS (
    SELECT h.class_id, h.user_id, max(h.created_at) AS start_at
    FROM class_enrollment_history h
    WHERE h.class_id = ANY(_class_ids) AND h.action = 'added'
    GROUP BY h.class_id, h.user_id
  ),
  st AS (
    SELECT cs.class_id, cs.user_id, e.start_at
    FROM class_students cs
    LEFT JOIN enroll e ON e.class_id = cs.class_id AND e.user_id = cs.user_id
    WHERE cs.class_id = ANY(_class_ids) AND cs.deleted_at IS NULL
  ),
  v AS (
    SELECT id, class_id, created_at FROM videos
    WHERE class_id = ANY(_class_ids) AND deleted_at IS NULL
  ),
  vc AS (
    SELECT v.class_id, count(*)::int AS video_count FROM v GROUP BY v.class_id
  ),
  sc AS (
    SELECT st.class_id, count(*)::int AS student_count FROM st GROUP BY st.class_id
  ),
  cells AS (
    SELECT st.class_id, st.user_id, v.id AS video_id
    FROM st JOIN v ON v.class_id = st.class_id
    WHERE st.start_at IS NULL OR v.created_at >= st.start_at
  ),
  agg AS (
    SELECT c.class_id,
      count(*)::int AS total_cells,
      count(p.is_completed) FILTER (WHERE p.is_completed)::int AS completed_cells,
      COALESCE(sum(p.watched_ratio), 0)::numeric AS sum_ratio
    FROM cells c
    LEFT JOIN video_progress p ON p.video_id = c.video_id AND p.user_id = c.user_id
    GROUP BY c.class_id
  )
  SELECT t.id,
    COALESCE(vc.video_count, 0),
    COALESCE(sc.student_count, 0),
    COALESCE(agg.total_cells, 0),
    COALESCE(agg.completed_cells, 0),
    COALESCE(agg.sum_ratio, 0)::numeric
  FROM unnest(_class_ids) AS t(id)
  LEFT JOIN vc ON vc.class_id = t.id
  LEFT JOIN sc ON sc.class_id = t.id
  LEFT JOIN agg ON agg.class_id = t.id;
$function$;

-- 학생별 통계: 상관 서브쿼리 → 집합 집계
CREATE OR REPLACE FUNCTION public.class_student_stats_agg(_class_id uuid)
 RETURNS TABLE(user_id uuid, video_total integer, completed integer, sum_ratio numeric, last_activity timestamp with time zone, enrolled_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH enroll AS (
    SELECT h.user_id, max(h.created_at) AS start_at
    FROM class_enrollment_history h
    WHERE h.class_id = _class_id AND h.action = 'added'
    GROUP BY h.user_id
  ),
  st AS (
    SELECT cs.user_id, e.start_at
    FROM class_students cs
    LEFT JOIN enroll e ON e.user_id = cs.user_id
    WHERE cs.class_id = _class_id AND cs.deleted_at IS NULL
  ),
  v AS (
    SELECT id, created_at FROM videos WHERE class_id = _class_id AND deleted_at IS NULL
  ),
  cells AS (
    SELECT st.user_id, v.id AS video_id
    FROM st CROSS JOIN v
    WHERE st.start_at IS NULL OR v.created_at >= st.start_at
  ),
  agg AS (
    SELECT c.user_id,
      count(*)::int AS video_total,
      count(p.is_completed) FILTER (WHERE p.is_completed)::int AS completed,
      COALESCE(sum(p.watched_ratio), 0)::numeric AS sum_ratio,
      max(p.updated_at) AS last_activity
    FROM cells c
    LEFT JOIN video_progress p ON p.video_id = c.video_id AND p.user_id = c.user_id
    GROUP BY c.user_id
  )
  SELECT st.user_id,
    COALESCE(agg.video_total, 0),
    COALESCE(agg.completed, 0),
    COALESCE(agg.sum_ratio, 0)::numeric,
    agg.last_activity,
    st.start_at
  FROM st
  LEFT JOIN agg ON agg.user_id = st.user_id;
$function$;

-- 전체 요약: 단일 스캔
CREATE OR REPLACE FUNCTION public.overview_stats_agg(_class_ids uuid[])
 RETURNS TABLE(video_count integer, student_count integer, total_views integer, completed_count integer, sum_ratio numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH v AS (
    SELECT id FROM videos WHERE class_id = ANY(_class_ids) AND deleted_at IS NULL
  ),
  p AS (
    SELECT vp.is_completed, vp.watched_ratio
    FROM video_progress vp JOIN v ON v.id = vp.video_id
  ),
  s AS (
    SELECT count(DISTINCT cs.user_id)::int AS student_count
    FROM class_students cs
    WHERE cs.class_id = ANY(_class_ids) AND cs.deleted_at IS NULL
  )
  SELECT
    (SELECT count(*) FROM v)::int,
    (SELECT student_count FROM s),
    (SELECT count(*) FROM p)::int,
    (SELECT count(*) FROM p WHERE p.is_completed)::int,
    COALESCE((SELECT sum(p.watched_ratio) FROM p), 0)::numeric;
$function$;