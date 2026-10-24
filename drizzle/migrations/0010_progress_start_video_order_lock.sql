-- 1. 시작 영상을 id로 저장할 칸 추가
ALTER TABLE public.class_students ADD COLUMN progress_start_video_id uuid;
COMMENT ON COLUMN public.class_students.progress_start_video_id IS '학습 현황/시청 범위 시작 영상. 설정 시 화면 표시 순서(폴더 순서 → 폴더 안 영상 순서) 기준으로 이 영상부터 포함';

-- 2. 기존 progress_start_at 값을 해당 created_at의 영상 id로 이전
UPDATE public.class_students cs
SET progress_start_video_id = (
  SELECT v.id FROM public.videos v
  WHERE v.class_id = cs.class_id
    AND v.created_at = cs.progress_start_at
    AND v.deleted_at IS NULL
  ORDER BY v.id
  LIMIT 1
)
WHERE cs.progress_start_at IS NOT NULL
  AND cs.deleted_at IS NULL;

-- 3. 잠금 판정 함수: 시작 영상이 id로 설정돼 있으면 화면 표시 순서 기준, 아니면 기존 시각 기준
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
      (SELECT (v.folder_sort, v.sort_order, v.created_at, v.id) < (sv.folder_sort, sv.sort_order, sv.created_at, sv.id) FROM v, sv)
    WHEN (SELECT progress_start_video_id FROM cs) IS NOT NULL THEN false
    ELSE
      (SELECT v.created_at < COALESCE(public.student_video_start_at(_user_id, v.class_id), '-infinity'::timestamptz) FROM v)
  END
$function$;

REVOKE EXECUTE ON FUNCTION public.student_video_locked(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_video_locked(uuid, uuid) TO authenticated, service_role;

-- 4. 학생용 영상 조회 정책: 잠금 판정을 순서 기준 함수로 교체
DROP POLICY "Students view published videos in their classes" ON public.videos;
CREATE POLICY "Students view published videos in their classes"
ON public.videos FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'student'::app_role)
  AND is_published = true
  AND status = 'ready'
  AND class_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.class_students cs
    WHERE cs.class_id = videos.class_id AND cs.user_id = auth.uid() AND cs.deleted_at IS NULL
  )
  AND NOT is_video_excluded_for(auth.uid(), id)
  AND (NOT public.student_video_locked(auth.uid(), id) OR has_video_progress(auth.uid(), id))
);

-- 5. 영상 접근 검사 함수도 같은 기준으로
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
          AND (
            NOT public.student_video_locked(_user_id, v.id)
            OR EXISTS (
              SELECT 1 FROM public.video_progress vp
              WHERE vp.video_id = v.id AND vp.user_id = _user_id
            )
          )
        )
      )
  )
$function$;

-- 6. 학습 현황 집계도 같은 잠금 기준 사용
CREATE OR REPLACE FUNCTION public.class_student_stats_agg(_class_id uuid)
RETURNS TABLE(user_id uuid, video_total integer, completed integer, sum_ratio numeric, last_activity timestamp with time zone, enrolled_at timestamp with time zone)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public'
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
    WHERE NOT public.student_video_locked(st.user_id, v.id)
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
SET search_path = 'public'
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
    WHERE NOT public.student_video_locked(st.user_id, v.id)
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