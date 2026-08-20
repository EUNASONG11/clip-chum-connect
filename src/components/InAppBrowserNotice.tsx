import { useEffect, useState } from "react";
import { ExternalLink, X, Copy } from "lucide-react";
import { toast } from "sonner";
import {
  detectInAppBrowser,
  inAppBrowserLabel,
  isAndroidDevice,
  isIOSDevice,
  openInExternalBrowser,
  type InAppBrowser,
} from "@/lib/device";

const DISMISS_KEY = "inapp-notice-dismissed";

export function InAppBrowserNotice() {
  const [show, setShow] = useState(false);
  const [android, setAndroid] = useState(false);
  const [browser, setBrowser] = useState<InAppBrowser>(null);

  useEffect(() => {
    if (sessionStorage.getItem(DISMISS_KEY) === "1") return;
    const detected = detectInAppBrowser();
    if (!detected) return;
    setBrowser(detected);
    setAndroid(isAndroidDevice());
    setShow(true);
  }, []);

  if (!show) return null;

  const dismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, "1");
    setShow(false);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("링크를 복사했어요. Safari에서 붙여넣어 열어주세요.");
    } catch {
      toast.error("링크 복사에 실패했어요. 주소창을 길게 눌러 복사해주세요.");
    }
  };

  return (
    <div className="sticky top-0 z-[120] border-b bg-primary/10 px-4 py-2.5 text-xs">
      <div className="mx-auto flex max-w-6xl items-center gap-2">
        <p className="flex-1 leading-relaxed text-foreground">
          {android
            ? `${inAppBrowserLabel(browser)} 인앱 브라우저에서는 전체화면이 제한될 수 있어요. 크롬으로 열면 더 편하게 볼 수 있어요.`
            : `${inAppBrowserLabel(browser)} 인앱 브라우저에서는 전체화면이 제한돼요. Safari에서 열면 더 편하게 볼 수 있어요.`}
        </p>
        {android || isIOSDevice() ? (
          <button
            type="button"
            onClick={() => (android ? openInExternalBrowser() : copyLink())}
            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 font-semibold text-primary-foreground"
          >
            {android ? <ExternalLink className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {android ? "크롬으로 열기" : "링크 복사"}
          </button>
        ) : null}
        <button type="button" onClick={dismiss} aria-label="닫기" className="shrink-0 p-1 text-muted-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
