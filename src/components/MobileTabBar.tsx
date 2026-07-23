import { Link, useLocation } from "@tanstack/react-router";
import { GraduationCap, User } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export function MobileTabBar() {
  const location = useLocation();
  const [isAuthed, setIsAuthed] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setIsAuthed(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setIsAuthed(!!s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // 로그인/관리자 화면에서는 숨김
  if (!isAuthed) return null;
  const path = location.pathname;
  if (path.startsWith("/admin") || path.startsWith("/login")) return null;

  const tabs = [
    { to: "/", label: "내 클래스", icon: GraduationCap, match: (p: string) => p === "/" || p.startsWith("/class") || p.startsWith("/video") },
    { to: "/mypage", label: "마이페이지", icon: User, match: (p: string) => p.startsWith("/mypage") },
  ] as const;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 backdrop-blur md:hidden">
      <ul className="mx-auto grid max-w-md grid-cols-2">
        {tabs.map((t) => {
          const active = t.match(path);
          const Icon = t.icon;
          return (
            <li key={t.to}>
              <Link
                to={t.to}
                className={`flex flex-col items-center justify-center gap-1 py-2.5 text-xs transition ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <Icon className={`h-5 w-5 ${active ? "text-primary" : ""}`} />
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  );
}
