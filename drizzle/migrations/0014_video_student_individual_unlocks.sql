CREATE TABLE public.video_student_unlocks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), video_id uuid NOT NULL REFERENCES public.videos(id), user_id uuid NOT NULL, created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz, UNIQUE(video_id,user_id));
GRANT SELECT,INSERT,UPDATE ON public.video_student_unlocks TO authenticated;
GRANT ALL ON public.video_student_unlocks TO service_role;
ALTER TABLE public.video_student_unlocks ENABLE ROW LEVEL SECURITY;
CREATE INDEX video_student_unlocks_active ON public.video_student_unlocks(user_id,video_id) WHERE deleted_at IS NULL;
CREATE OR REPLACE FUNCTION public.can_manage_video_unlock_class(_class_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
SELECT EXISTS (SELECT 1 FROM public.classes c WHERE c.id=_class_id AND c.deleted_at IS NULL AND (
 public.has_role(auth.uid(),'admin') OR
 (public.has_role(auth.uid(),'branch_admin') AND public.branch_admin_branch(auth.uid()) IS NOT NULL AND public.instructor_can_access_class(auth.uid(),c.id)) OR
 (public.has_role(auth.uid(),'instructor') AND (c.created_by=auth.uid() OR EXISTS(SELECT 1 FROM public.class_instructors ci WHERE ci.class_id=c.id AND ci.instructor_user_id=auth.uid() AND ci.deleted_at IS NULL) OR EXISTS(SELECT 1 FROM public.class_categories cc JOIN public.instructors i ON i.auth_user_id=auth.uid() AND i.is_active WHERE cc.id=c.category_id AND cc.deleted_at IS NULL AND cc.cohort IS NOT NULL AND (cc.cohort=i.cohort OR cc.cohort=ANY(i.cohorts)))))
)); $$;
REVOKE ALL ON FUNCTION public.can_manage_video_unlock_class(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_manage_video_unlock_class(uuid) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.can_manage_video_unlock(_video_id uuid,_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
SELECT EXISTS(SELECT 1 FROM public.videos v JOIN public.class_students cs ON cs.class_id=v.class_id AND cs.user_id=_user_id AND cs.deleted_at IS NULL WHERE v.id=_video_id AND v.deleted_at IS NULL AND public.can_manage_video_unlock_class(v.class_id) AND (
 public.has_role(auth.uid(),'admin') OR NOT public.has_role(auth.uid(),'branch_admin') OR EXISTS(SELECT 1 FROM public.external_students e WHERE e.auth_user_id=_user_id AND NOT e.is_deleted AND e.branch=public.branch_admin_branch(auth.uid())))); $$;
REVOKE ALL ON FUNCTION public.can_manage_video_unlock(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_manage_video_unlock(uuid,uuid) TO authenticated,service_role;
CREATE POLICY "Staff read scoped unlocks" ON public.video_student_unlocks FOR SELECT TO authenticated USING (public.can_manage_video_unlock(video_id,user_id));
CREATE POLICY "Staff insert scoped unlocks" ON public.video_student_unlocks FOR INSERT TO authenticated WITH CHECK (created_by=auth.uid() AND public.can_manage_video_unlock(video_id,user_id) AND EXISTS(SELECT 1 FROM public.videos v WHERE v.id=video_id AND v.is_published AND v.status='ready' AND v.deleted_at IS NULL));
CREATE POLICY "Staff update scoped unlocks" ON public.video_student_unlocks FOR UPDATE TO authenticated USING(public.can_manage_video_unlock(video_id,user_id)) WITH CHECK(public.can_manage_video_unlock(video_id,user_id) AND created_by=auth.uid());
CREATE OR REPLACE FUNCTION public.has_video_unlock(_user_id uuid,_video_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
SELECT (_user_id=auth.uid() OR auth.role()='service_role') AND EXISTS(SELECT 1 FROM public.video_student_unlocks u WHERE u.user_id=_user_id AND u.video_id=_video_id AND u.deleted_at IS NULL); $$;
REVOKE ALL ON FUNCTION public.has_video_unlock(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.has_video_unlock(uuid,uuid) TO authenticated,service_role;
ALTER POLICY "Students view published videos in their classes" ON public.videos USING (public.has_role(auth.uid(),'student') AND is_published=true AND status='ready' AND class_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.class_students cs WHERE cs.class_id=videos.class_id AND cs.user_id=auth.uid() AND cs.deleted_at IS NULL) AND NOT public.is_video_excluded_for(auth.uid(),id) AND (NOT public.student_video_locked(auth.uid(),id) OR public.has_video_progress(auth.uid(),id) OR public.has_video_unlock(auth.uid(),id)));
CREATE OR REPLACE FUNCTION public.can_access_video(_user_id uuid,_video_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
SELECT EXISTS(SELECT 1 FROM public.videos v WHERE v.id=_video_id AND v.deleted_at IS NULL AND (public.has_role(_user_id,'admin') OR public.has_role(_user_id,'instructor') OR (public.has_role(_user_id,'student') AND v.is_published AND v.status='ready' AND v.class_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.class_students cs WHERE cs.class_id=v.class_id AND cs.user_id=_user_id AND cs.deleted_at IS NULL) AND NOT EXISTS(SELECT 1 FROM public.video_student_exclusions x WHERE x.video_id=v.id AND x.user_id=_user_id AND x.deleted_at IS NULL) AND (NOT public.student_video_locked(_user_id,v.id) OR EXISTS(SELECT 1 FROM public.video_progress p WHERE p.video_id=v.id AND p.user_id=_user_id) OR EXISTS(SELECT 1 FROM public.video_student_unlocks u WHERE u.video_id=v.id AND u.user_id=_user_id AND u.deleted_at IS NULL))))); $$;
CREATE OR REPLACE FUNCTION public.class_student_stats_agg_range(_class_id uuid,_from timestamptz DEFAULT NULL,_to timestamptz DEFAULT NULL) RETURNS TABLE(user_id uuid,video_total integer,completed integer,sum_ratio numeric,last_activity timestamptz,enrolled_at timestamptz) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
WITH enroll AS (SELECT h.user_id,max(h.created_at) start_at FROM public.class_enrollment_history h WHERE h.class_id=_class_id AND h.action='added' GROUP BY h.user_id),
st AS (SELECT cs.user_id,e.start_at FROM public.class_students cs LEFT JOIN enroll e ON e.user_id=cs.user_id WHERE cs.class_id=_class_id AND cs.deleted_at IS NULL),
v AS (SELECT vd.id,vd.created_at FROM public.videos vd JOIN public.class_folders f ON f.id=vd.folder_id AND f.deleted_at IS NULL AND f.is_required WHERE vd.class_id=_class_id AND vd.deleted_at IS NULL AND (_from IS NULL OR vd.created_at>=_from) AND (_to IS NULL OR vd.created_at<_to)),
cells AS (SELECT st.user_id,v.id video_id FROM st CROSS JOIN v WHERE (NOT public.student_video_locked(st.user_id,v.id) OR EXISTS(SELECT 1 FROM public.video_progress p WHERE p.user_id=st.user_id AND p.video_id=v.id) OR EXISTS(SELECT 1 FROM public.video_student_unlocks u WHERE u.user_id=st.user_id AND u.video_id=v.id AND u.deleted_at IS NULL)) AND NOT EXISTS(SELECT 1 FROM public.video_student_exclusions x WHERE x.video_id=v.id AND x.user_id=st.user_id AND x.deleted_at IS NULL)),
agg AS (SELECT c.user_id,count(*)::int video_total,count(p.is_completed) FILTER(WHERE p.is_completed)::int completed,coalesce(sum(p.watched_ratio),0)::numeric sum_ratio,max(p.updated_at) last_activity FROM cells c LEFT JOIN public.video_progress p ON p.video_id=c.video_id AND p.user_id=c.user_id GROUP BY c.user_id)
SELECT st.user_id,coalesce(agg.video_total,0),coalesce(agg.completed,0),coalesce(agg.sum_ratio,0)::numeric,agg.last_activity,st.start_at FROM st LEFT JOIN agg ON agg.user_id=st.user_id; $$;
CREATE OR REPLACE FUNCTION public.class_student_stats_agg(_class_id uuid) RETURNS TABLE(user_id uuid,video_total integer,completed integer,sum_ratio numeric,last_activity timestamptz,enrolled_at timestamptz) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT * FROM public.class_student_stats_agg_range(_class_id,NULL,NULL); $$;
CREATE OR REPLACE FUNCTION public.video_student_access_states(_class_id uuid,_user_ids uuid[] DEFAULT NULL,_video_ids uuid[] DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb; branch_scope text; excluded integer;
BEGIN
 IF NOT public.can_manage_video_unlock_class(_class_id) THEN RAISE EXCEPTION '해당 수강반에 대한 권한이 없습니다.'; END IF;
 IF public.has_role(auth.uid(),'branch_admin') AND NOT public.has_role(auth.uid(),'admin') THEN branch_scope:=public.branch_admin_branch(auth.uid()); END IF;
 SELECT count(*) INTO excluded FROM public.class_students cs WHERE cs.class_id=_class_id AND cs.deleted_at IS NULL AND (_user_ids IS NULL OR cs.user_id=ANY(_user_ids)) AND branch_scope IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.external_students e WHERE e.auth_user_id=cs.user_id AND NOT e.is_deleted AND e.branch=branch_scope);
 WITH st AS MATERIALIZED (SELECT cs.user_id,coalesce(e.name,'') name,coalesce(e.school,'') school,coalesce(e.grade,'') grade,coalesce(e.branch,'') branch,coalesce(e.phone,'') phone,coalesce(e.parent_phone,'') parent_phone,
 (SELECT count(*) FROM public.video_student_unlocks u JOIN public.videos uv ON uv.id=u.video_id WHERE u.user_id=cs.user_id AND u.deleted_at IS NULL AND uv.class_id=_class_id AND uv.deleted_at IS NULL)::int unlock_count
 FROM public.class_students cs LEFT JOIN LATERAL(SELECT * FROM public.external_students e WHERE e.auth_user_id=cs.user_id AND NOT e.is_deleted ORDER BY e.id LIMIT 1)e ON true WHERE cs.class_id=_class_id AND cs.deleted_at IS NULL AND (_user_ids IS NULL OR cs.user_id=ANY(_user_ids)) AND (branch_scope IS NULL OR e.branch=branch_scope)),
 v AS MATERIALIZED(SELECT id,title,thumbnail_url,week_label,created_at,folder_id,sort_order FROM public.videos WHERE class_id=_class_id AND deleted_at IS NULL AND is_published AND status='ready' AND (_video_ids IS NULL OR id=ANY(_video_ids))),
 states AS(SELECT v.id video_id,st.user_id,CASE WHEN x.id IS NOT NULL THEN 'hidden' WHEN NOT public.student_video_locked(st.user_id,v.id) OR p.user_id IS NOT NULL THEN 'not_locked' WHEN u.id IS NOT NULL THEN 'unlocked' ELSE 'locked' END state FROM st CROSS JOIN v LEFT JOIN public.video_student_exclusions x ON x.user_id=st.user_id AND x.video_id=v.id AND x.deleted_at IS NULL LEFT JOIN public.video_progress p ON p.user_id=st.user_id AND p.video_id=v.id LEFT JOIN public.video_student_unlocks u ON u.user_id=st.user_id AND u.video_id=v.id AND u.deleted_at IS NULL)
 SELECT jsonb_build_object('students',coalesce((SELECT jsonb_agg(to_jsonb(st) ORDER BY st.name,st.user_id) FROM st),'[]'::jsonb),'videos',coalesce((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.sort_order,v.created_at DESC,v.id) FROM v),'[]'::jsonb),'folders',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'parent_folder_id',f.parent_folder_id,'sort_order',f.sort_order) ORDER BY f.sort_order,f.id) FROM public.class_folders f WHERE f.class_id=_class_id AND f.deleted_at IS NULL),'[]'::jsonb),'states',coalesce((SELECT jsonb_agg(to_jsonb(states)) FROM states),'[]'::jsonb),'excluded_count',excluded) INTO result;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.video_student_access_states(uuid,uuid[],uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.video_student_access_states(uuid,uuid[],uuid[]) TO authenticated;
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
 UPDATE public.video_student_unlocks u SET deleted_at=now(),created_by=auth.uid() WHERE u.deleted_at IS NULL AND u.video_id=ANY(_video_ids) AND u.user_id IN (SELECT s.user_id FROM jsonb_to_recordset(snapshot->'students') AS s(user_id uuid));
 GET DIAGNOSTICS affected=ROW_COUNT;
 END IF;
 RETURN jsonb_build_object('affected',affected,'excluded_count',snapshot->'excluded_count');
END; $$;
REVOKE ALL ON FUNCTION public.set_video_student_unlocks(uuid,uuid[],uuid[],boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_video_student_unlocks(uuid,uuid[],uuid[],boolean) TO authenticated;