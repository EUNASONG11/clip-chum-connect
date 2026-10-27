CREATE OR REPLACE FUNCTION public.class_student_video_targets(_class_id uuid, _video_ids uuid[] DEFAULT NULL)
RETURNS TABLE(user_id uuid, video_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT cs.user_id, v.id AS video_id
  FROM public.class_students cs
  JOIN public.videos v ON v.class_id = cs.class_id AND v.deleted_at IS NULL
  WHERE cs.class_id = _class_id AND cs.deleted_at IS NULL
    AND (_video_ids IS NULL OR v.id = ANY(_video_ids))
    AND NOT EXISTS (SELECT 1 FROM public.video_student_exclusions x WHERE x.user_id = cs.user_id AND x.video_id = v.id AND x.deleted_at IS NULL)
    AND (NOT public.student_video_locked(cs.user_id, v.id)
      OR EXISTS (SELECT 1 FROM public.video_progress p WHERE p.user_id = cs.user_id AND p.video_id = v.id)
      OR EXISTS (SELECT 1 FROM public.video_student_unlocks u WHERE u.user_id = cs.user_id AND u.video_id = v.id AND u.deleted_at IS NULL));
$$;
REVOKE ALL ON FUNCTION public.class_student_video_targets(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.class_student_video_targets(uuid, uuid[]) TO service_role;
COMMENT ON FUNCTION public.class_student_video_targets(uuid, uuid[]) IS 'Shared messaging/statistics targets. Service-role server calls only after caller authorization; hidden overrides progress and unlock exceptions.';

CREATE OR REPLACE FUNCTION public.class_student_stats_agg_range(_class_id uuid, _from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL)
RETURNS TABLE(user_id uuid, video_total integer, completed integer, sum_ratio numeric, last_activity timestamptz, enrolled_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH enroll AS (SELECT h.user_id,max(h.created_at) start_at FROM public.class_enrollment_history h WHERE h.class_id=_class_id AND h.action='added' GROUP BY h.user_id),
st AS (SELECT cs.user_id,e.start_at FROM public.class_students cs LEFT JOIN enroll e ON e.user_id=cs.user_id WHERE cs.class_id=_class_id AND cs.deleted_at IS NULL),
v AS (SELECT vd.id FROM public.videos vd JOIN public.class_folders f ON f.id=vd.folder_id AND f.deleted_at IS NULL AND f.is_required WHERE vd.class_id=_class_id AND vd.deleted_at IS NULL AND (_from IS NULL OR vd.created_at>=_from) AND (_to IS NULL OR vd.created_at<_to)),
cells AS (SELECT t.user_id,t.video_id FROM public.class_student_video_targets(_class_id, ARRAY(SELECT v.id FROM v)) t),
agg AS (SELECT c.user_id,count(*)::int video_total,count(p.is_completed) FILTER(WHERE p.is_completed)::int completed,coalesce(sum(p.watched_ratio),0)::numeric sum_ratio,max(p.updated_at) last_activity FROM cells c LEFT JOIN public.video_progress p ON p.video_id=c.video_id AND p.user_id=c.user_id GROUP BY c.user_id)
SELECT st.user_id,coalesce(agg.video_total,0),coalesce(agg.completed,0),coalesce(agg.sum_ratio,0)::numeric,agg.last_activity,st.start_at FROM st LEFT JOIN agg ON agg.user_id=st.user_id;
$$;
REVOKE ALL ON FUNCTION public.class_student_stats_agg_range(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.class_student_stats_agg_range(uuid, timestamptz, timestamptz) TO service_role;