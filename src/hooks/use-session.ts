import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * 현재 세션 상태. 저장된 세션이 서버에서 이미 무효화된 경우(session_not_found)
 * 로컬 세션을 정리해서 "Unauthorized: No authorization header" 오류 루프를 막는다.
 */
export function useSession() {
  const [status, setStatus] = useState<"loading" | "signedIn" | "signedOut">("loading");

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        if (mounted) setStatus("signedOut");
        return;
      }
      const { error } = await supabase.auth.getUser();
      if (error) {
        await supabase.auth.signOut({ scope: "local" }).catch(() => {});
        if (mounted) setStatus("signedOut");
        return;
      }
      if (mounted) setStatus("signedIn");
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (mounted) setStatus(session ? "signedIn" : "signedOut");
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return status;
}
