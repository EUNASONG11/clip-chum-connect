CREATE OR REPLACE FUNCTION public.set_video_student_unlocks(_class_id uuid,_user_ids uuid[],_video_ids uuid[],_unlock boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE snapshot jsonb; affected integer:=0;
BEGIN
 IF cardinality(_user_ids)>2000 OR cardinality(_video_ids)>2000 THEN RAISE EXCEPTION '선택 대상이 너무 많습니다.'; END IF;
 snapshot:=public.video_student_access_states(_class_id,_user_ids,_video_ids);
 IF _unlock THEN
 INSERT INTO public.video_student_unlocks(video_id,user_id,created_by)
 SELECT s.video_id,s.user_id,auth.uid() FROM jsonb_to_recordset(snapshot->'states') AS s(video_id uuid,user_id uuid,state text) WHERE s.state='locked'
 ON CONFLICT(video_id,user_id) DO UPDATE SET deleted_at=NULL,created_by=auth.uid();
 GET DIAGNOSTICS affected=ROW_COUNT;
 ELSE
 UPDATE public.video_student_unlocks u SET deleted_at=now(),created_by=auth.uid() WHERE u.deleted_at IS NULL AND u.video_id IN (SELECT v.id FROM jsonb_to_recordset(snapshot->'videos') AS v(id uuid)) AND u.user_id IN (SELECT s.user_id FROM jsonb_to_recordset(snapshot->'students') AS s(user_id uuid));
 GET DIAGNOSTICS affected=ROW_COUNT;
 END IF;
 RETURN jsonb_build_object('affected',affected,'excluded_count',snapshot->'excluded_count');
END; $$;
ALTER POLICY "Staff update scoped unlocks" ON public.video_student_unlocks WITH CHECK(public.can_manage_video_unlock(video_id,user_id) AND created_by=auth.uid() AND (deleted_at IS NOT NULL OR EXISTS(SELECT 1 FROM public.videos v WHERE v.id=video_id AND v.is_published AND v.status='ready' AND v.deleted_at IS NULL)));