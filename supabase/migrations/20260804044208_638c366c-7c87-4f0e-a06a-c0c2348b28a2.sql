-- 1) 외부 과제 연동 링크
CREATE TABLE public.external_assignment_links (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source text NOT NULL DEFAULT 'elearning',
  external_id text NOT NULL,
  class_id uuid REFERENCES public.classes(id) ON DELETE SET NULL,
  assignment_type text NOT NULL,
  scope text NOT NULL DEFAULT 'individual',
  period_start date,
  period_end date,
  remote_assignment_type_id text,
  student_count integer NOT NULL DEFAULT 0,
  last_synced_at timestamp with time zone,
  last_error text,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  deleted_at timestamp with time zone,
  deleted_by uuid,
  UNIQUE (source, external_id)
);

GRANT SELECT ON public.external_assignment_links TO authenticated;
GRANT ALL ON public.external_assignment_links TO service_role;

ALTER TABLE public.external_assignment_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view assignment links"
ON public.external_assignment_links FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'instructor'::app_role)
);

CREATE TRIGGER external_assignment_links_updated_at
BEFORE UPDATE ON public.external_assignment_links
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_eal_class ON public.external_assignment_links(class_id) WHERE deleted_at IS NULL;

-- 2) 학생별 완료 통보 기록
CREATE TABLE public.external_assignment_completions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  link_id uuid NOT NULL REFERENCES public.external_assignment_links(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  video_id uuid REFERENCES public.videos(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending',
  remote_status text,
  error_message text,
  occurred_at timestamp with time zone NOT NULL DEFAULT now(),
  sent_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (link_id, user_id)
);

GRANT SELECT ON public.external_assignment_completions TO authenticated;
GRANT ALL ON public.external_assignment_completions TO service_role;

ALTER TABLE public.external_assignment_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view assignment completions"
ON public.external_assignment_completions FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'instructor'::app_role)
);

CREATE TRIGGER external_assignment_completions_updated_at
BEFORE UPDATE ON public.external_assignment_completions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_eac_link ON public.external_assignment_completions(link_id);