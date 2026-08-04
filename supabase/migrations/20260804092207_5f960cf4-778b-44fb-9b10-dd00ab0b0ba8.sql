CREATE TABLE public.sms_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id uuid NOT NULL,
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('sms','brandtalk')),
  message text NOT NULL,
  user_id uuid,
  recipient_name text NOT NULL DEFAULT '',
  phone text NOT NULL,
  branch text,
  success boolean NOT NULL DEFAULT false,
  error_message text,
  sent_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX sms_logs_class_created_idx ON public.sms_logs (class_id, created_at DESC);
CREATE INDEX sms_logs_batch_idx ON public.sms_logs (batch_id);

GRANT SELECT ON public.sms_logs TO authenticated;
GRANT ALL ON public.sms_logs TO service_role;

ALTER TABLE public.sms_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view sms logs"
ON public.sms_logs FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Instructors can view sms logs of their classes"
ON public.sms_logs FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'instructor'::app_role)
  AND EXISTS (
    SELECT 1 FROM public.classes c
    WHERE c.id = sms_logs.class_id
      AND (
        c.created_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.class_instructors ci
          WHERE ci.class_id = c.id
            AND ci.instructor_user_id = auth.uid()
            AND ci.deleted_at IS NULL
        )
      )
  )
);