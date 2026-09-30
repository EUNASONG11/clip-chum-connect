-- 특정 학생에게 특정 영상 숨기기 설정 테이블
CREATE TABLE public.video_student_exclusions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX video_student_exclusions_active_unique
  ON public.video_student_exclusions (video_id, user_id)
  WHERE deleted_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.video_student_exclusions TO authenticated;
GRANT ALL ON public.video_student_exclusions TO service_role;

ALTER TABLE public.video_student_exclusions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "학생은 본인 숨김 여부만 조회"
  ON public.video_student_exclusions FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "관리자/강사 조회"
  ON public.video_student_exclusions FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.videos v
      WHERE v.id = video_id
        AND public.instructor_can_access_class(auth.uid(), v.class_id)
    )
  );

CREATE POLICY "관리자/강사 추가"
  ON public.video_student_exclusions FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.videos v
      WHERE v.id = video_id
        AND public.instructor_can_access_class(auth.uid(), v.class_id)
    )
  );

CREATE POLICY "관리자/강사 수정"
  ON public.video_student_exclusions FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.videos v
      WHERE v.id = video_id
        AND public.instructor_can_access_class(auth.uid(), v.class_id)
    )
  );

-- can_access_video: 학생 분기에 숨김 영상 제외 조건 추가
CREATE OR REPLACE FUNCTION public.can_access_video(_user_id uuid, _video_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.videos v
    WHERE v.id = _video_id
      AND v.deleted_at IS NULL
      AND (
        public.has_role(_user_id, 'admin'::app_role)
        OR public.has_role(_user_id, 'instructor'::app_role)
        OR (
          public.has_role(_user_id, 'student'::app_role)
          AND v.is_published = true
          AND v.status = 'ready'
          AND v.class_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.class_students cs
            WHERE cs.class_id = v.class_id
              AND cs.user_id = _user_id
              AND cs.deleted_at IS NULL
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.video_student_exclusions x
            WHERE x.video_id = v.id
              AND x.user_id = _user_id
              AND x.deleted_at IS NULL
          )
        )
      )
  )
$function$;

-- 학생별 학습 현황 집계: 숨김 영상은 그 학생의 계산에서 제외
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
    SELECT vd.id, vd.created_at FROM videos vd
    JOIN class_folders f ON f.id = vd.folder_id AND f.deleted_at IS NULL AND f.is_required
    WHERE vd.class_id = _class_id AND vd.deleted_at IS NULL
  ),
  cells AS (
    SELECT st.user_id, v.id AS video_id
    FROM st CROSS JOIN v
    WHERE (st.start_at IS NULL OR v.created_at >= st.start_at)
      AND NOT EXISTS (
        SELECT 1 FROM video_student_exclusions x
        WHERE x.video_id = v.id AND x.user_id = st.user_id AND x.deleted_at IS NULL
      )
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

CREATE OR REPLACE FUNCTION public.class_student_stats_agg_range(_class_id uuid, _from timestamp with time zone DEFAULT NULL::timestamp with time zone, _to timestamp with time zone DEFAULT NULL::timestamp with time zone)
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
    SELECT vd.id, vd.created_at FROM videos vd
    JOIN class_folders f ON f.id = vd.folder_id AND f.deleted_at IS NULL AND f.is_required
    WHERE vd.class_id = _class_id AND vd.deleted_at IS NULL
      AND (_from IS NULL OR vd.created_at >= _from)
      AND (_to IS NULL OR vd.created_at < _to)
  ),
  cells AS (
    SELECT st.user_id, v.id AS video_id
    FROM st CROSS JOIN v
    WHERE (st.start_at IS NULL OR v.created_at >= st.start_at)
      AND NOT EXISTS (
        SELECT 1 FROM video_student_exclusions x
        WHERE x.video_id = v.id AND x.user_id = st.user_id AND x.deleted_at IS NULL
      )
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