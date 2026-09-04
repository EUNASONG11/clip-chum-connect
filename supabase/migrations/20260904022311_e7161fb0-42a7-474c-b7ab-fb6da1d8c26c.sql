
DROP POLICY IF EXISTS "Admin upload class thumbnails" ON storage.objects;
DROP POLICY IF EXISTS "Admin update class thumbnails" ON storage.objects;
DROP POLICY IF EXISTS "Admin delete class thumbnails" ON storage.objects;
DROP POLICY IF EXISTS "Admin/Instructor upload video thumbnails" ON storage.objects;
DROP POLICY IF EXISTS "Admin/Instructor update video thumbnails" ON storage.objects;
DROP POLICY IF EXISTS "Admin/Instructor delete video thumbnails" ON storage.objects;

CREATE POLICY "Staff upload class thumbnails" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'class-thumbnails' AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'instructor') OR public.branch_admin_branch(auth.uid()) IS NOT NULL));

CREATE POLICY "Staff update class thumbnails" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'class-thumbnails' AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'instructor') OR public.branch_admin_branch(auth.uid()) IS NOT NULL))
WITH CHECK (bucket_id = 'class-thumbnails' AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'instructor') OR public.branch_admin_branch(auth.uid()) IS NOT NULL));

CREATE POLICY "Staff delete class thumbnails" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'class-thumbnails' AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'instructor') OR public.branch_admin_branch(auth.uid()) IS NOT NULL));

CREATE POLICY "Staff upload video thumbnails" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'video-thumbnails' AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'instructor') OR public.branch_admin_branch(auth.uid()) IS NOT NULL));

CREATE POLICY "Staff update video thumbnails" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'video-thumbnails' AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'instructor') OR public.branch_admin_branch(auth.uid()) IS NOT NULL))
WITH CHECK (bucket_id = 'video-thumbnails' AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'instructor') OR public.branch_admin_branch(auth.uid()) IS NOT NULL));

CREATE POLICY "Staff delete video thumbnails" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'video-thumbnails' AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'instructor') OR public.branch_admin_branch(auth.uid()) IS NOT NULL));
