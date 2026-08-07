ALTER TABLE public.sms_logs ADD COLUMN IF NOT EXISTS hidden_at timestamptz;

CREATE OR REPLACE FUNCTION public.class_sms_recent_batches(_class_id uuid, _limit integer DEFAULT 30)
 RETURNS TABLE(batch_id uuid, last_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT l.batch_id, max(l.created_at) AS last_at
  FROM sms_logs l
  WHERE l.class_id = _class_id
    AND l.hidden_at IS NULL
  GROUP BY l.batch_id
  ORDER BY max(l.created_at) DESC
  LIMIT greatest(1, least(coalesce(_limit, 30), 200));
$function$;