import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getMyRole } from "@/lib/vimeo.functions";
import { Button } from "@/components/ui/button";
import { Video, LogOut, Upload } from "lucide-react";

export function SiteHeader() {
  const [email, setEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const sync = async () => {
      const { data } = await supabase.auth.getUser();
      setEmail(data.user?.email ?? null);
      if (data.user) {
        try {
          const r = await getMyRole();
          setIsAdmin(r.isAdmin);
        } catch {
          setIsAdmin(false);
        }
      } else {
        setIsAdmin(false);
      }
    };
    sync();
    const { data: sub } = supabase.auth.onAuthStateChange(() => sync());
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <header className="border-b bg-card/50 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link to="/" className="flex items-center gap-2 font-bold text-lg">
          <Video className="h-5 w-5 text-primary" />
          VimStream
        </Link>
        <nav className="flex items-center gap-2">
          {email ? (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link to="/admin">
                  <Upload className="mr-1 h-4 w-4" /> 관리자
                </Link>
              </Button>
              <span className="hidden text-sm text-muted-foreground sm:inline">{email}</span>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await supabase.auth.signOut();
                }}
              >
                <LogOut className="mr-1 h-4 w-4" /> 로그아웃
              </Button>
            </>
          ) : (
            <Button asChild size="sm">
              <Link to="/auth">로그인</Link>
            </Button>
          )}
        </nav>
      </div>
    </header>
  );
}
