ALTER TABLE public.notices ADD COLUMN IF NOT EXISTS display_type text NOT NULL DEFAULT 'card';
ALTER TABLE public.notices DROP CONSTRAINT IF EXISTS notices_display_type_check;
ALTER TABLE public.notices ADD CONSTRAINT notices_display_type_check CHECK (display_type IN ('main','card'));