ALTER TABLE public.external_assignment_links
  ADD COLUMN IF NOT EXISTS needs_resync boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sync_status text,
  ADD COLUMN IF NOT EXISTS students_hash text;