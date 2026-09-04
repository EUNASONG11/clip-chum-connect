CREATE POLICY "Branch admins create classes"
ON public.classes FOR INSERT TO authenticated
WITH CHECK (
  public.branch_admin_branch(auth.uid()) IS NOT NULL
  AND created_by = auth.uid()
);

CREATE POLICY "Branch admins view accessible classes"
ON public.classes FOR SELECT TO authenticated
USING (
  public.branch_admin_branch(auth.uid()) IS NOT NULL
  AND public.instructor_can_access_class(auth.uid(), id)
);

CREATE POLICY "Branch admins update accessible classes"
ON public.classes FOR UPDATE TO authenticated
USING (
  public.branch_admin_branch(auth.uid()) IS NOT NULL
  AND public.instructor_can_access_class(auth.uid(), id)
)
WITH CHECK (
  public.branch_admin_branch(auth.uid()) IS NOT NULL
  AND public.instructor_can_access_class(auth.uid(), id)
);