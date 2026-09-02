CREATE TABLE public.notices (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  branch text,
  is_pinned boolean NOT NULL DEFAULT false,
  is_published boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  deleted_at timestamp with time zone,
  deleted_by uuid
);

GRANT SELECT ON public.notices TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notices TO authenticated;
GRANT ALL ON public.notices TO service_role;

ALTER TABLE public.notices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view published notices"
ON public.notices FOR SELECT
TO anon, authenticated
USING (is_published = true AND deleted_at IS NULL);

CREATE POLICY "Admins can view all notices"
ON public.notices FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Branch admins can view their branch notices"
ON public.notices FOR SELECT
TO authenticated
USING (
  public.branch_admin_branch(auth.uid()) IS NOT NULL
  AND (branch IS NULL OR branch = public.branch_admin_branch(auth.uid()))
);

CREATE POLICY "Admins can insert notices"
ON public.notices FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) AND created_by = auth.uid());

CREATE POLICY "Branch admins can insert their branch notices"
ON public.notices FOR INSERT
TO authenticated
WITH CHECK (
  public.branch_admin_branch(auth.uid()) IS NOT NULL
  AND created_by = auth.uid()
  AND (branch IS NULL OR branch = public.branch_admin_branch(auth.uid()))
);

CREATE POLICY "Admins can update notices"
ON public.notices FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Branch admins can update their branch notices"
ON public.notices FOR UPDATE
TO authenticated
USING (
  public.branch_admin_branch(auth.uid()) IS NOT NULL
  AND (branch IS NULL OR branch = public.branch_admin_branch(auth.uid()))
)
WITH CHECK (
  public.branch_admin_branch(auth.uid()) IS NOT NULL
  AND (branch IS NULL OR branch = public.branch_admin_branch(auth.uid()))
);

CREATE POLICY "Admins can delete notices"
ON public.notices FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Branch admins can delete their branch notices"
ON public.notices FOR DELETE
TO authenticated
USING (
  public.branch_admin_branch(auth.uid()) IS NOT NULL
  AND (branch IS NULL OR branch = public.branch_admin_branch(auth.uid()))
);

CREATE INDEX notices_public_idx ON public.notices (is_pinned DESC, created_at DESC) WHERE deleted_at IS NULL AND is_published = true;

CREATE TRIGGER notices_updated_at
BEFORE UPDATE ON public.notices
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();