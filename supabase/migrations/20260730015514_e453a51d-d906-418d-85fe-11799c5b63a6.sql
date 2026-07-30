DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['videos','classes','class_folders','class_students','class_instructors']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS hide_soft_deleted ON public.%I', t);
    EXECUTE format('CREATE POLICY hide_soft_deleted ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (deleted_at IS NULL OR public.has_role(auth.uid(), ''admin''::app_role) OR public.has_role(auth.uid(), ''instructor''::app_role))', t);
  END LOOP;
END $$;