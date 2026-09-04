DROP POLICY IF EXISTS "Branch admins create classes" ON public.classes;
DROP POLICY IF EXISTS "Branch admins view accessible classes" ON public.classes;
DROP POLICY IF EXISTS "Branch admins update accessible classes" ON public.classes;

CREATE POLICY "Branch admins create classes"
ON public.classes FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'branch_admin'::app_role)
  AND created_by = auth.uid()
);

CREATE POLICY "Branch admins view accessible classes"
ON public.classes FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'branch_admin'::app_role)
  AND (created_by = auth.uid() OR public.instructor_can_access_class(auth.uid(), id))
);

CREATE POLICY "Branch admins update accessible classes"
ON public.classes FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'branch_admin'::app_role)
  AND (created_by = auth.uid() OR public.instructor_can_access_class(auth.uid(), id))
)
WITH CHECK (
  public.has_role(auth.uid(), 'branch_admin'::app_role)
  AND (created_by = auth.uid() OR public.instructor_can_access_class(auth.uid(), id))
);