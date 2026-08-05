-- 수강반별 통계 (배정 시점 이후 영상만 대상)
CREATE OR REPLACE FUNCTION public.class_stats_agg(_class_ids uuid[])
RETURNS TABLE (
  class_id uuid,
  video_count integer,
  student_count integer,
  total_cells integer,
  completed_cells integer,
  sum_ratio numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH st AS (
    SELECT cs.class_id, cs.user_id,
      (SELECT max(h.created_at) FROM class_enrollment_history h
        WHERE h.class_id = cs.class_id AND h.user_id = cs.user_id AND h.action = 'added') AS start_at
    FROM class_students cs
    WHERE cs.class_id = ANY(_class_ids) AND cs.deleted_at IS NULL
  ),
  v AS (
    SELECT id, class_id, created_at FROM videos
    WHERE class_id = ANY(_class_ids) AND deleted_at IS NULL
  ),
  cells AS (
    SELECT st.class_id, st.user_id, v.id AS video_id
    FROM st JOIN v ON v.class_id = st.class_id
    WHERE st.start_at IS NULL OR v.created_at >= st.start_at
  ),
  cp AS (
    SELECT c.class_id, p.is_completed, p.watched_ratio
    FROM cells c
    JOIN video_progress p ON p.video_id = c.video_id AND p.user_id = c.user_id
  )
  SELECT
    t.id,
    (SELECT count(*) FROM v WHERE v.class_id = t.id)::int,
    (SELECT count(*) FROM st WHERE st.class_id = t.id)::int,
    (SELECT count(*) FROM cells WHERE cells.class_id = t.id)::int,
    COALESCE((SELECT count(*) FROM cp WHERE cp.class_id = t.id AND cp.is_completed), 0)::int,
    COALESCE((SELECT sum(cp.watched_ratio) FROM cp WHERE cp.class_id = t.id), 0)::numeric
  FROM unnest(_class_ids) AS t(id);
$$;

-- 전체 요약 통계
CREATE OR REPLACE FUNCTION public.overview_stats_agg(_class_ids uuid[])
RETURNS TABLE (
  video_count integer,
  student_count integer,
  total_views integer,
  completed_count integer,
  sum_ratio numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH v AS (
    SELECT id FROM videos WHERE class_id = ANY(_class_ids) AND deleted_at IS NULL
  ),
  p AS (
    SELECT vp.is_completed, vp.watched_ratio
    FROM video_progress vp JOIN v ON v.id = vp.video_id
  )
  SELECT
    (SELECT count(*) FROM v)::int,
    (SELECT count(DISTINCT cs.user_id) FROM class_students cs
       WHERE cs.class_id = ANY(_class_ids) AND cs.deleted_at IS NULL)::int,
    (SELECT count(*) FROM p)::int,
    (SELECT count(*) FROM p WHERE p.is_completed)::int,
    COALESCE((SELECT sum(p.watched_ratio) FROM p), 0)::numeric;
$$;

-- 특정 수강반 학생별 상세
CREATE OR REPLACE FUNCTION public.class_student_stats_agg(_class_id uuid)
RETURNS TABLE (
  user_id uuid,
  video_total integer,
  completed integer,
  sum_ratio numeric,
  last_activity timestamptz,
  enrolled_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH st AS (
    SELECT cs.user_id,
      (SELECT max(h.created_at) FROM class_enrollment_history h
        WHERE h.class_id = _class_id AND h.user_id = cs.user_id AND h.action = 'added') AS start_at
    FROM class_students cs
    WHERE cs.class_id = _class_id AND cs.deleted_at IS NULL
  ),
  v AS (
    SELECT id, created_at FROM videos WHERE class_id = _class_id AND deleted_at IS NULL
  ),
  cells AS (
    SELECT st.user_id, v.id AS video_id
    FROM st CROSS JOIN v
    WHERE st.start_at IS NULL OR v.created_at >= st.start_at
  )
  SELECT
    st.user_id,
    (SELECT count(*) FROM cells c WHERE c.user_id = st.user_id)::int,
    COALESCE((SELECT count(*) FROM cells c
       JOIN video_progress p ON p.video_id = c.video_id AND p.user_id = c.user_id
       WHERE c.user_id = st.user_id AND p.is_completed), 0)::int,
    COALESCE((SELECT sum(p.watched_ratio) FROM cells c
       JOIN video_progress p ON p.video_id = c.video_id AND p.user_id = c.user_id
       WHERE c.user_id = st.user_id), 0)::numeric,
    (SELECT max(p.updated_at) FROM cells c
       JOIN video_progress p ON p.video_id = c.video_id AND p.user_id = c.user_id
       WHERE c.user_id = st.user_id),
    st.start_at
  FROM st;
$$;

-- 서버(관리자 권한) 코드에서만 호출: 클라이언트 직접 호출 차단
REVOKE ALL ON FUNCTION public.class_stats_agg(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.overview_stats_agg(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.class_student_stats_agg(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.class_stats_agg(uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.overview_stats_agg(uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.class_student_stats_agg(uuid) TO service_role;