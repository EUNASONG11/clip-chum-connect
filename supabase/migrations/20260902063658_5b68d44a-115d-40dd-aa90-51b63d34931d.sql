CREATE OR REPLACE FUNCTION public.instructor_can_access_class(_uid uuid, _class_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    exists (
      select 1 from public.instructors i
      where i.auth_user_id = _uid and i.all_branches = true and i.is_active = true
    )
    or (
      _class_id is not null and (
        exists (select 1 from public.classes c where c.id = _class_id and c.created_by = _uid)
        or exists (
          select 1 from public.class_instructors ci
          where ci.class_id = _class_id
            and ci.instructor_user_id = _uid
            and ci.deleted_at is null
        )
        or exists (
          select 1 from public.classes c
          where c.id = _class_id
            and public.branch_admin_branch(_uid) is not null
            and (c.branch is null or c.branch = public.branch_admin_branch(_uid))
        )
      )
    )
$function$;