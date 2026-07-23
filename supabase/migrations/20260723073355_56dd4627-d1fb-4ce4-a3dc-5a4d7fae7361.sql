
-- classes: instructors can manage
CREATE POLICY "Instructors manage classes" ON public.classes
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'instructor'))
  WITH CHECK (public.has_role(auth.uid(), 'instructor'));

-- class_students: instructors can manage
CREATE POLICY "Instructors manage class_students" ON public.class_students
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'instructor'))
  WITH CHECK (public.has_role(auth.uid(), 'instructor'));

-- videos: instructors view all
CREATE POLICY "Instructors view all videos" ON public.videos
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'instructor'));

-- video_progress: instructors view all
CREATE POLICY "Instructors view all progress" ON public.video_progress
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'instructor'));
