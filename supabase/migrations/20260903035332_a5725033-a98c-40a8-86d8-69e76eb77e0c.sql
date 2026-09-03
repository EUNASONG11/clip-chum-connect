CREATE POLICY "notice images manage by managers" ON storage.objects FOR ALL TO authenticated
USING (bucket_id = 'notice-images' AND (public.has_role(auth.uid(), 'admin') OR public.branch_admin_branch(auth.uid()) IS NOT NULL))
WITH CHECK (bucket_id = 'notice-images' AND (public.has_role(auth.uid(), 'admin') OR public.branch_admin_branch(auth.uid()) IS NOT NULL));