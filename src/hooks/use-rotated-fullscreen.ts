import { useEffect, useState } from "react";
import { isIOSDevice } from "@/lib/device";

/**
 * 네이티브 전체화면이 불가능한 환경(아이폰/인앱 브라우저)에서
 * CSS 폴백 전체화면일 때 세로 화면이면 영상을 90도 회전시켜 가로로 꽉 채운다.
 */
export function useRotatedFullscreen(active: boolean, fallback: boolean) {
  const [portrait, setPortrait] = useState(false);

  useEffect(() => {
    if (!active || !fallback) {
      setPortrait(false);
      return;
    }
    const update = () => setPortrait(window.innerHeight > window.innerWidth);
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, [active, fallback]);

  const rotated = active && fallback && portrait && isIOSDevice();

  const style: React.CSSProperties = rotated
    ? {
        width: "min(100dvh, calc(100vw * 16 / 9))",
        maxWidth: "none",
        transform: "rotate(90deg)",
        transformOrigin: "center center",
      }
    : {
        width: "min(100vw, calc(100dvh * 16 / 9))",
        maxWidth: "100vw",
        maxHeight: "100dvh",
      };

  return { rotated, style };
}
