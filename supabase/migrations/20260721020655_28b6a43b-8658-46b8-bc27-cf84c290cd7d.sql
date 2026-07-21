
-- comments
CREATE TABLE public.comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.comments TO authenticated;
GRANT ALL ON public.comments TO service_role;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

-- 접근 가능한 영상 확인용 헬퍼 (RLS에서 하위 SELECT 시 자기 참조 문제 방지)
CREATE OR REPLACE FUNCTION public.can_access_video(_user_id uuid, _video_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.videos v
    WHERE v.id = _video_id AND (
      public.has_role(_user_id, 'admin'::app_role)
      OR (
        v.is_published = true
        AND v.status = 'ready'
        AND v.class_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.class_students cs
          WHERE cs.class_id = v.class_id AND cs.user_id = _user_id
        )
      )
    )
  )
$$;

CREATE POLICY "View comments on accessible videos" ON public.comments
  FOR SELECT TO authenticated
  USING (public.can_access_video(auth.uid(), video_id));

CREATE POLICY "Insert own comments on accessible videos" ON public.comments
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.can_access_video(auth.uid(), video_id));

CREATE POLICY "Update own comments" ON public.comments
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Delete own or admin comments" ON public.comments
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER comments_updated_at BEFORE UPDATE ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- bookmarks
CREATE TABLE public.bookmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  video_id uuid NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  seconds integer NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bookmarks TO authenticated;
GRANT ALL ON public.bookmarks TO service_role;
ALTER TABLE public.bookmarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own bookmarks" ON public.bookmarks
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX bookmarks_user_video_idx ON public.bookmarks (user_id, video_id, seconds);
