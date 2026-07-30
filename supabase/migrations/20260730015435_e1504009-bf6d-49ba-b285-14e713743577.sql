DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['user_roles','videos','classes','class_students','comments','bookmarks','class_instructors','class_folders','class_categories','teams','team_members','team_messages']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS hide_soft_deleted ON public.%I', t);
    EXECUTE format('CREATE POLICY hide_soft_deleted ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (deleted_at IS NULL OR public.has_role(auth.uid(), ''admin''::app_role))', t);
  END LOOP;
END $$;