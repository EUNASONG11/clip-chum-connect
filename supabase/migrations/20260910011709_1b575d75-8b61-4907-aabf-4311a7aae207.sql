CREATE OR REPLACE FUNCTION public.instructor_can_access_class(_uid uuid, _class_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.instructors i
      WHERE i.auth_user_id = _uid
        AND i.all_branches = true
        AND i.is_active = true
    )
    OR (
      _class_id IS NOT NULL
      AND (
        EXISTS (
          SELECT 1
          FROM public.classes c
          WHERE c.id = _class_id
            AND c.deleted_at IS NULL
            AND c.created_by = _uid
        )
        OR EXISTS (
          SELECT 1
          FROM public.class_instructors ci
          WHERE ci.class_id = _class_id
            AND ci.instructor_user_id = _uid
            AND ci.deleted_at IS NULL
        )
        OR EXISTS (
          SELECT 1
          FROM public.classes c
          WHERE c.id = _class_id
            AND c.deleted_at IS NULL
            AND public.branch_admin_branch(_uid) IS NOT NULL
            AND (
              c.branch IS NULL
              OR c.branch = public.branch_admin_branch(_uid)
            )
        )
        OR EXISTS (
          SELECT 1
          FROM public.classes c
          JOIN public.class_categories cc
            ON cc.id = c.category_id
           AND cc.deleted_at IS NULL
          JOIN public.instructors i
            ON i.auth_user_id = _uid
           AND i.is_active = true
          WHERE c.id = _class_id
            AND c.deleted_at IS NULL
            AND cc.cohort IS NOT NULL
            AND (
              cc.cohort = i.cohort
              OR cc.cohort = ANY(COALESCE(i.cohorts, ARRAY[]::text[]))
            )
            AND (
              c.branch IS NULL
              OR i.all_branches = true
              OR c.branch = i.branch
              OR (
                i.branch = '상동'
                AND (
                  c.branch = '상동 교육원'
                  OR c.branch LIKE '부천 상동교육원%'
                )
              )
              OR (
                c.branch = '상동'
                AND (
                  i.branch = '상동 교육원'
                  OR i.branch LIKE '부천 상동교육원%'
                )
              )
            )
        )
      )
    )
$function$;

DROP POLICY IF EXISTS "Branch admins view accessible videos" ON public.videos;
CREATE POLICY "Branch admins view accessible videos"
ON public.videos
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'branch_admin'::app_role)
  AND (
    created_by = auth.uid()
    OR public.instructor_can_access_class(auth.uid(), class_id)
  )
);