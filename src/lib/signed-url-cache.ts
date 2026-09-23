import { supabase } from "@/integrations/supabase/client";

type Entry = { url: string; expiresAt: number };
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<string | null>>();

const TTL_SEC = 60 * 60; // 1h
const SAFETY_MS = 60 * 1000; // 1분 여유

// 썸네일 값이 프라이빗 버킷의 경로인 경우 경로만 추출
export function extractStoragePath(bucket: string, value: string): string | null {
  if (!value) return null;
  const marker = `/${bucket}/`;
  const idx = value.indexOf(marker);
  if (idx >= 0) return value.slice(idx + marker.length).split("?")[0];
  if (!value.startsWith("http")) return value;
  return null;
}

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

// 목록 화면용: 여러 썸네일의 서명 주소를 한 번의 요청으로 미리 발급받아 캐시에 채운다.
export function prefetchSignedThumbUrls(bucket: string, paths: string[]): void {
  const now = Date.now();
  const needed = Array.from(new Set(paths.filter(Boolean))).filter((p) => {
    const cached = cache.get(`${bucket}:${p}`);
    return !(cached && cached.expiresAt - SAFETY_MS > now) && !inflight.has(`${bucket}:${p}`);
  });
  if (needed.length === 0) return;
  // 진행 중 표시를 걸어 개별 요청이 중복으로 나가지 않게 한다.
  const done = new Promise<string | null>((resolve) => resolve(null));
  needed.forEach((p) => inflight.set(`${bucket}:${p}`, done));
  supabase.storage
    .from(bucket)
    .createSignedUrls(needed, TTL_SEC)
    .then(({ data, error }) => {
      const expiresAt = Date.now() + TTL_SEC * 1000;
      needed.forEach((p) => inflight.delete(`${bucket}:${p}`));
      if (error || !data) return;
      data.forEach((row: any) => {
        if (row?.path && row?.signedUrl) {
          cache.set(`${bucket}:${row.path}`, { url: row.signedUrl, expiresAt });
        }
      });
    })
    .catch(() => {
      needed.forEach((p) => inflight.delete(`${bucket}:${p}`));
    });
}
