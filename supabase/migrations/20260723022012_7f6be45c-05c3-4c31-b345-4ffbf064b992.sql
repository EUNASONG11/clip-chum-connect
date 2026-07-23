
ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS thumbnail_url text;

DROP POLICY IF EXISTS "Public read class thumbnails" ON storage.objects;
CREATE POLICY "Public read class thumbnails" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'class-thumbnails');

DROP POLICY IF EXISTS "Admin upload class thumbnails" ON storage.objects;
CREATE POLICY "Admin upload class thumbnails" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'class-thumbnails' AND public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admin update class thumbnails" ON storage.objects;
CREATE POLICY "Admin update class thumbnails" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'class-thumbnails' AND public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admin delete class thumbnails" ON storage.objects;
CREATE POLICY "Admin delete class thumbnails" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'class-thumbnails' AND public.has_role(auth.uid(), 'admin'::app_role));
