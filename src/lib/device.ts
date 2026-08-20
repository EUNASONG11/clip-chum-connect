export function isIOSDevice() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const iOSLike = /iPad|iPhone|iPod/.test(ua);
  const iPadOS = /Macintosh/.test(ua) && typeof document !== "undefined" && "ontouchend" in document;
  return iOSLike || iPadOS;
}

export type InAppBrowser =
  | "kakao"
  | "line"
  | "naver"
  | "whale"
  | "facebook"
  | "instagram"
  | "threads"
  | "band"
  | "daum"
  | "everytime"
  | "tiktok"
  | "snapchat"
  | "twitter"
  | "linkedin"
  | "pinterest"
  | "wechat"
  | "telegram"
  | "slack"
  | "discord"
  | "electron"
  | "other"
  | null;

export function detectInAppBrowser(): InAppBrowser {
  if (typeof navigator === "undefined") return null;
  const ua = (navigator.userAgent || "").toLowerCase();

  if (ua.includes("kakaotalk")) return "kakao";
  if (/\bline\//.test(ua) || ua.includes("line/")) return "line";
  if (ua.includes("naver(inapp") || ua.includes("naverapp") || ua.includes("naver ")) return "naver";
  if (ua.includes("whale")) return "whale";
  if (ua.includes("bandapp") || ua.includes("naverband")) return "band";
  if (ua.includes("barcelona")) return "threads";
  if (ua.includes("instagram")) return "instagram";
  if (ua.includes("fbav") || ua.includes("fban") || ua.includes("fb_iab") || ua.includes("fbios"))
    return "facebook";
  if (ua.includes("daumapps") || ua.includes("daum/")) return "daum";
  if (ua.includes("everytimeapp")) return "everytime";
  if (ua.includes("bytedancewebview") || ua.includes("musical_ly") || ua.includes("tiktok"))
    return "tiktok";
  if (ua.includes("snapchat")) return "snapchat";
  if (ua.includes("twitter")) return "twitter";
  if (ua.includes("linkedinapp")) return "linkedin";
  if (ua.includes("pinterest")) return "pinterest";
  if (ua.includes("micromessenger")) return "wechat";
  if (ua.includes("telegram")) return "telegram";
  if (ua.includes("slack_ssb")) return "slack";
  if (ua.includes("discord")) return "discord";
  if (ua.includes("electron")) return "electron";

  // 일반 WebView 감지 (안드로이드 wv, iOS: Safari 토큰 없는 모바일 WebView)
  if (/; wv\)/.test(ua)) return "other";
  const isIOSUa = /iphone|ipod|ipad/.test(ua);
  if (isIOSUa && ua.includes("applewebkit") && !ua.includes("safari") && !ua.includes("crios"))
    return "other";
  return null;
}

export function isAndroidDevice() {
  if (typeof navigator === "undefined") return false;
  return /android/i.test(navigator.userAgent || "");
}

/** 안드로이드에서 현재 페이지를 크롬으로 강제 실행 */
export function openInExternalBrowser() {
  if (typeof window === "undefined") return;
  const url = window.location.href;
  if (isAndroidDevice()) {
    const noScheme = url.replace(/^https?:\/\//, "");
    window.location.href = `intent://${noScheme}#Intent;scheme=https;package=com.android.chrome;end`;
    return;
  }
  // iOS: 카카오톡 인앱 브라우저는 외부 브라우저 전환 스킴을 제공하지 않음
  const ua = (navigator.userAgent || "").toLowerCase();
  if (ua.includes("kakaotalk")) {
    window.location.href = `kakaotalk://web/openExternal?url=${encodeURIComponent(url)}`;
  }
}

const IN_APP_LABELS: Record<Exclude<NonNullable<InAppBrowser>, never>, string> = {
  kakao: "카카오톡",
  line: "라인",
  naver: "네이버",
  whale: "웨일",
  facebook: "페이스북",
  instagram: "인스타그램",
  threads: "스레드",
  band: "네이버 밴드",
  daum: "다음",
  everytime: "에브리타임",
  tiktok: "틱톡",
  snapchat: "스냅챗",
  twitter: "X(트위터)",
  linkedin: "링크드인",
  pinterest: "핀터레스트",
  wechat: "위챗",
  telegram: "텔레그램",
  slack: "슬랙",
  discord: "디스코드",
  electron: "앱",
  other: "앱",
};

export function inAppBrowserLabel(browser: InAppBrowser): string {
  if (!browser) return "앱";
  return IN_APP_LABELS[browser] ?? "앱";
}
