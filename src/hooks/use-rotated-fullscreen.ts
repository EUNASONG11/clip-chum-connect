import { useEffect, useState } from "react";
import { isIOSDevice } from "@/lib/device";

/**
 * 네이티브 전체화면이 불가능한 환경(아이폰/인앱 브라우저)에서
 * CSS 폴백 전체화면일 때 실제 뷰포트 픽셀 크기를 측정해
 * 16:9 영상이 화면에 최대한 꽉 차도록 크기를 계산한다.
 * (vh/dvh 단위는 iOS 인앱 브라우저에서 툴바 때문에 실제보다 작게 잡혀 여백이 커진다)
 */
export function useRotatedFullscreen(active: boolean, fallback: boolean) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    if (!active || !fallback) {
      setSize(null);
      return;
    }
    const update = () => {
      const vv = window.visualViewport;
      const w = Math.round(vv?.width ?? window.innerWidth);
      const h = Math.round(vv?.height ?? window.innerHeight);
      setSize({ w, h });
    };
    update();
    // iOS는 회전 직후 값이 갱신되기 전이라 약간 지연 후 재측정
    const t = window.setTimeout(update, 300);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, [active, fallback]);

  const portrait = !!size && size.h > size.w;
  const rotated = active && fallback && portrait && isIOSDevice();

  let style: React.CSSProperties;
  if (!size) {
    style = { width: "min(100vw, calc(100dvh * 16 / 9))", maxWidth: "100vw", maxHeight: "100dvh" };
  } else if (rotated) {
    // 90도 회전 상태: 화면 높이가 영상의 가로가 된다
    const width = Math.min(size.h, (size.w * 16) / 9);
    style = {
      width: `${width}px`,
      height: `${(width * 9) / 16}px`,
      maxWidth: "none",
      maxHeight: "none",
      transform: "rotate(90deg)",
      transformOrigin: "center center",
    };
  } else {
    const width = Math.min(size.w, (size.h * 16) / 9);
    style = {
      width: `${width}px`,
      height: `${(width * 9) / 16}px`,
      maxWidth: "none",
      maxHeight: "none",
    };
  }

  return { rotated, style };
}
