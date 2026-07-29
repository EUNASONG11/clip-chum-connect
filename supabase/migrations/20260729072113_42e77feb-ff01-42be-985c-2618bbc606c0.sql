
-- 1) 컬럼 추가
ALTER TABLE public.videos            ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS deleted_by UUID;
ALTER TABLE public.classes           ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS deleted_by UUID;
ALTER TABLE public.class_folders     ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS deleted_by UUID;
ALTER TABLE public.class_categories  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS deleted_by UUID;
ALTER TABLE public.teams             ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS deleted_by UUID;
ALTER TABLE public.team_members      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS deleted_by UUID;
ALTER TABLE public.team_messages     ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS deleted_by UUID;
ALTER TABLE public.comments          ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS deleted_by UUID;
ALTER TABLE public.bookmarks         ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS deleted_by UUID;
ALTER TABLE public.class_students    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS deleted_by UUID;
ALTER TABLE public.class_instructors ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS deleted_by UUID;
ALTER TABLE public.user_roles        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS deleted_by UUID;

-- 2) 부분 인덱스
CREATE INDEX IF NOT EXISTS idx_videos_active            ON public.videos            (id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_classes_active           ON public.classes           (id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_class_folders_active     ON public.class_folders     (class_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_class_categories_active  ON public.class_categories  (id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_teams_active             ON public.teams             (id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_team_members_active      ON public.team_members      (team_id, user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_team_messages_active     ON public.team_messages     (team_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_comments_active          ON public.comments          (video_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_bookmarks_active         ON public.bookmarks         (user_id, video_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_class_students_active    ON public.class_students    (class_id, user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_class_instructors_active ON public.class_instructors (class_id, instructor_user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_roles_active        ON public.user_roles        (user_id, role) WHERE deleted_at IS NULL;

-- 3) RESTRICTIVE SELECT 정책: 삭제된 행은 RLS 상에서 조회 안 됨 (supabaseAdmin은 우회)
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'videos','classes','class_folders','class_categories',
    'teams','team_members','team_messages',
    'comments','bookmarks',
    'class_students','class_instructors','user_roles'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS hide_soft_deleted ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY hide_soft_deleted ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (deleted_at IS NULL)',
      t
    );
  END LOOP;
END$$;

-- 4) can_access_video 함수도 삭제 필터 반영
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
        OR (
          v.is_published = true
          AND v.status = 'ready'
          AND v.class_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.class_students cs
            WHERE cs.class_id = v.class_id
              AND cs.user_id = _user_id
              AND cs.deleted_at IS NULL
          )
        )
      )
  )
$function$;

-- 5) has_role 함수도 소프트 삭제 반영 (역할 소프트 삭제 시 즉시 권한 무효화)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
      AND deleted_at IS NULL
  )
$function$;

-- 6) 배정 이력 트리거 확장: 소프트 삭제도 'removed' 로 기록, 복원은 'added' 로 기록
CREATE OR REPLACE FUNCTION public.log_class_enrollment_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.class_enrollment_history (class_id, user_id, action, actor_id)
    VALUES (NEW.class_id, NEW.user_id, 'added', auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.class_enrollment_history (class_id, user_id, action, actor_id)
    VALUES (OLD.class_id, OLD.user_id, 'removed', auth.uid());
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      INSERT INTO public.class_enrollment_history (class_id, user_id, action, actor_id)
      VALUES (NEW.class_id, NEW.user_id, 'removed', auth.uid());
    ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      INSERT INTO public.class_enrollment_history (class_id, user_id, action, actor_id)
      VALUES (NEW.class_id, NEW.user_id, 'added', auth.uid());
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS class_students_enrollment_log ON public.class_students;
CREATE TRIGGER class_students_enrollment_log
  AFTER INSERT OR UPDATE OR DELETE ON public.class_students
  FOR EACH ROW EXECUTE FUNCTION public.log_class_enrollment_change();
