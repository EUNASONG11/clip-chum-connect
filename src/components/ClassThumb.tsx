import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const BUCKET = "class-thumbnails";

function extractPath(value: string): string | null {
  if (!value) return null;
  const marker = `/${BUCKET}/`;
  const idx = value.indexOf(marker);
  if (idx >= 0) return value.slice(idx + marker.length).split("?")[0];
  if (!value.startsWith("http")) return value;
  return null;
}


// 프라이빗 버킷의 썸네일을 signed URL 로 표시
export function ClassThumb({
  src,
  alt = "",
  className,
}: {
  src: string | null | undefined;
  alt?: string;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    if (!src) return;
    const path = extractPath(src);
    if (!path) return;
    supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, 60 * 60)
      .then(({ data }) => {
        if (!cancelled) setUrl(data?.signedUrl ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [src]);

  if (!src || !url) return null;
  return <img src={url} alt={alt} className={className} />;
}
