CREATE POLICY "notice images public read" ON storage.objects FOR SELECT TO anon
USING (bucket_id = 'notice-images');