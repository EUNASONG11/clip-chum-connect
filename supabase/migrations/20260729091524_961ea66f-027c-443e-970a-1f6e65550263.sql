ALTER TABLE public.class_folders
  ADD COLUMN IF NOT EXISTS parent_folder_id uuid
  REFERENCES public.class_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS class_folders_parent_folder_id_idx
  ON public.class_folders(parent_folder_id);