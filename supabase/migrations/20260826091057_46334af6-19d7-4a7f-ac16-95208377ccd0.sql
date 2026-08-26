-- 강사 접근 범위 판정 함수 (배정 + 생성자, all_branches 강사는 전체)
create or replace function public.instructor_can_access_class(_uid uuid, _class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
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
      )
    )
$$;

-- 영상 기준 강사 판정도 동일 기준으로 통일
create or replace function public.is_video_class_instructor(_user_id uuid, _video_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.videos v
    where v.id = _video_id
      and (
        v.created_by = _user_id
        or public.instructor_can_access_class(_user_id, v.class_id)
      )
  )
$$;

-- ===== classes =====
drop policy if exists "Instructors manage classes" on public.classes;
drop policy if exists "Instructors view assigned classes" on public.classes;

create policy "Instructors view accessible classes"
  on public.classes for select to authenticated
  using (
    public.has_role(auth.uid(), 'instructor'::app_role)
    and public.instructor_can_access_class(auth.uid(), id)
  );

create policy "Instructors create own classes"
  on public.classes for insert to authenticated
  with check (
    public.has_role(auth.uid(), 'instructor'::app_role)
    and created_by = auth.uid()
  );

create policy "Instructors update accessible classes"
  on public.classes for update to authenticated
  using (
    public.has_role(auth.uid(), 'instructor'::app_role)
    and public.instructor_can_access_class(auth.uid(), id)
  )
  with check (
    public.has_role(auth.uid(), 'instructor'::app_role)
    and public.instructor_can_access_class(auth.uid(), id)
  );

-- ===== class_students =====
drop policy if exists "Instructors manage class_students" on public.class_students;

create policy "Instructors view accessible class students"
  on public.class_students for select to authenticated
  using (
    public.has_role(auth.uid(), 'instructor'::app_role)
    and public.instructor_can_access_class(auth.uid(), class_id)
  );

create policy "Instructors add students to accessible classes"
  on public.class_students for insert to authenticated
  with check (
    public.has_role(auth.uid(), 'instructor'::app_role)
    and public.instructor_can_access_class(auth.uid(), class_id)
  );

create policy "Instructors update accessible class students"
  on public.class_students for update to authenticated
  using (
    public.has_role(auth.uid(), 'instructor'::app_role)
    and public.instructor_can_access_class(auth.uid(), class_id)
  )
  with check (
    public.has_role(auth.uid(), 'instructor'::app_role)
    and public.instructor_can_access_class(auth.uid(), class_id)
  );

-- ===== class_folders =====
drop policy if exists "Instructors manage class folders" on public.class_folders;

create policy "Instructors view accessible class folders"
  on public.class_folders for select to authenticated
  using (
    public.has_role(auth.uid(), 'instructor'::app_role)
    and public.instructor_can_access_class(auth.uid(), class_id)
  );

create policy "Instructors create folders in accessible classes"
  on public.class_folders for insert to authenticated
  with check (
    public.has_role(auth.uid(), 'instructor'::app_role)
    and public.instructor_can_access_class(auth.uid(), class_id)
  );

create policy "Instructors update accessible class folders"
  on public.class_folders for update to authenticated
  using (
    public.has_role(auth.uid(), 'instructor'::app_role)
    and public.instructor_can_access_class(auth.uid(), class_id)
  )
  with check (
    public.has_role(auth.uid(), 'instructor'::app_role)
    and public.instructor_can_access_class(auth.uid(), class_id)
  );

-- ===== videos =====
drop policy if exists "Instructors view all videos" on public.videos;
drop policy if exists "Instructors view own class videos" on public.videos;

create policy "Instructors view accessible videos"
  on public.videos for select to authenticated
  using (
    public.has_role(auth.uid(), 'instructor'::app_role)
    and (
      created_by = auth.uid()
      or public.instructor_can_access_class(auth.uid(), class_id)
    )
  );

-- ===== video_progress =====
drop policy if exists "Instructors view all progress" on public.video_progress;

create policy "Instructors view accessible progress"
  on public.video_progress for select to authenticated
  using (
    public.has_role(auth.uid(), 'instructor'::app_role)
    and exists (
      select 1 from public.videos v
      where v.id = video_progress.video_id
        and (
          v.created_by = auth.uid()
          or public.instructor_can_access_class(auth.uid(), v.class_id)
        )
    )
  );
