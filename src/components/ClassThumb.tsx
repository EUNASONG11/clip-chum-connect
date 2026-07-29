import { useEffect, useState } from "react";
import { getSignedThumbUrl } from "@/lib/signed-url-cache";

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
    if (!src) {
      setUrl(null);
      return;
    }
    const path = extractPath(src);
    if (!path) {
      // 외부 URL (Vimeo/YouTube 썸네일 등) 은 그대로 사용
      if (src.startsWith("http")) setUrl(src);
      else setUrl(null);
      return;
    }
    getSignedThumbUrl(BUCKET, path).then((u) => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [src]);

  if (!src || !url) return null;
  return (
    <img
      src={url}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
    />
  );
}
