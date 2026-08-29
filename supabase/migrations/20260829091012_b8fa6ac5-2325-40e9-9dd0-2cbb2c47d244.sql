CREATE OR REPLACE FUNCTION public.class_student_stats_agg_range(_class_id uuid, _from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL)
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
    SELECT id, created_at FROM videos
    WHERE class_id = _class_id AND deleted_at IS NULL
      AND (_from IS NULL OR created_at >= _from)
      AND (_to IS NULL OR created_at < _to)
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

REVOKE ALL ON FUNCTION public.class_student_stats_agg_range(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.class_student_stats_agg_range(uuid, timestamptz, timestamptz) TO service_role;