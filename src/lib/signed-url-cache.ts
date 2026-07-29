import { supabase } from "@/integrations/supabase/client";

type Entry = { url: string; expiresAt: number };
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<string | null>>();

const TTL_SEC = 60 * 60; // 1h
const SAFETY_MS = 60 * 1000; // 1분 여유

export function getSignedThumbUrl(bucket: string, path: string): Promise<string | null> {
  const key = `${bucket}:${path}`;
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt - SAFETY_MS > now) return Promise.resolve(cached.url);
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = supabase.storage
    .from(bucket)
    .createSignedUrl(path, TTL_SEC)
    .then(({ data }) => {
      inflight.delete(key);
      const url = data?.signedUrl ?? null;
      if (url) cache.set(key, { url, expiresAt: now + TTL_SEC * 1000 });
      return url;
    })
    .catch(() => {
      inflight.delete(key);
      return null;
    });
  inflight.set(key, p);
  return p;
}
