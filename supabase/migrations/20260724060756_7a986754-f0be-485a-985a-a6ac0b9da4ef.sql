
CREATE POLICY "Public read video thumbnails" ON storage.objects
FOR SELECT USING (bucket_id = 'video-thumbnails');

CREATE POLICY "Admin/Instructor upload video thumbnails" ON storage.objects
FOR INSERT WITH CHECK (
  bucket_id = 'video-thumbnails'
  AND (public.has_role(auth.uid(), 'admin'::public.app_role)
       OR public.has_role(auth.uid(), 'instructor'::public.app_role))
);

CREATE POLICY "Admin/Instructor update video thumbnails" ON storage.objects
FOR UPDATE USING (
  bucket_id = 'video-thumbnails'
  AND (public.has_role(auth.uid(), 'admin'::public.app_role)
       OR public.has_role(auth.uid(), 'instructor'::public.app_role))
);

CREATE POLICY "Admin/Instructor delete video thumbnails" ON storage.objects
FOR DELETE USING (
  bucket_id = 'video-thumbnails'
  AND (public.has_role(auth.uid(), 'admin'::public.app_role)
       OR public.has_role(auth.uid(), 'instructor'::public.app_role))
);
