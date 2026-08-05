CREATE OR REPLACE FUNCTION public.class_sms_recent_batches(_class_id uuid, _limit integer DEFAULT 30)
RETURNS TABLE (batch_id uuid, last_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.batch_id, max(l.created_at) AS last_at
  FROM sms_logs l
  WHERE l.class_id = _class_id
  GROUP BY l.batch_id
  ORDER BY max(l.created_at) DESC
  LIMIT greatest(1, least(coalesce(_limit, 30), 200));
$$;

REVOKE ALL ON FUNCTION public.class_sms_recent_batches(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.class_sms_recent_batches(uuid, integer) TO service_role;

CREATE INDEX IF NOT EXISTS sms_logs_class_created_idx ON public.sms_logs (class_id, created_at DESC);