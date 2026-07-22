import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { getMyRole, getMyDisplayName } from "@/lib/vimeo.functions";
import { Button } from "@/components/ui/button";
import { Video, LogOut } from "lucide-react";


export function SiteHeader() {
  const [email, setEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();


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
    <header className="border-b border-border/60 bg-card">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link to="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
            <Video className="h-4 w-4" />
          </span>
          <span>VimStream</span>
        </Link>
        <nav className="flex items-center gap-3">
          {email ? (
            <>
              <span className="hidden rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground sm:inline">
                {email}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="rounded-full"
                onClick={async () => {
                  await queryClient.cancelQueries();
                  queryClient.clear();
                  await supabase.auth.signOut();
                  navigate({ to: "/login", replace: true });
                }}
              >
                <LogOut className="mr-1 h-4 w-4" /> 로그아웃
              </Button>
            </>
          ) : (
            <Button asChild size="sm" className="rounded-full">
              <Link to="/login">로그인</Link>
            </Button>
          )}
        </nav>
      </div>
    </header>
  );
}
