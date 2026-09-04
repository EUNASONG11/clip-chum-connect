import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getMyRole, getMyDisplayName, getMyStatus, getMyInstructorProfile } from "@/lib/vimeo.functions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Video, LogOut, UserRound } from "lucide-react";

export function SiteHeader() {
  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    const sync = async () => {
      const { data } = await supabase.auth.getUser();
      setEmail(data.user?.email ?? null);
      setUserId(data.user?.id ?? null);
    };
    sync();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        sync();
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const { data: me } = useQuery({
    queryKey: ["me", userId],
    queryFn: async () => {
      const [r, n, s] = await Promise.all([getMyRole(), getMyDisplayName(), getMyStatus()]);
      return { isAdmin: r.isAdmin, name: n.name, isInstructor: s.isInstructor };
    },
    enabled: !!userId,
    staleTime: 10 * 60 * 1000,
  });

  const displayName = me?.name ?? null;
  const isInstructor = Boolean(me?.isInstructor);
  const [profileOpen, setProfileOpen] = useState(false);

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["my-instructor-profile", userId],
    queryFn: () => getMyInstructorProfile(),
    enabled: !!userId && isInstructor && profileOpen,
    staleTime: 5 * 60 * 1000,
  });

  return (
    <header className="border-b border-border/60 bg-card">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3 sm:px-6 sm:py-4">
        <Link to="/" className="flex shrink-0 items-center gap-2 text-base font-bold tracking-tight sm:text-lg">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
            <Video className="h-4 w-4" />
          </span>
          <span>e-Learning</span>
        </Link>
        <nav className="flex shrink-0 items-center gap-1.5 sm:gap-3">
          {email ? (
            <>
              {displayName && (
                <span className="hidden rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground sm:inline">
                  {displayName}
                </span>
              )}

              {isInstructor && (
                <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="outline" className="rounded-full">
                      <UserRound className="h-4 w-4 sm:mr-1" /> <span className="hidden sm:inline">마이페이지</span>
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>내 정보</DialogTitle>
                    </DialogHeader>
                    {profileLoading ? (
                      <p className="py-6 text-center text-sm text-muted-foreground">불러오는 중…</p>
                    ) : !profile?.instructor ? (
                      <p className="py-6 text-center text-sm text-muted-foreground">
                        강사 정보를 찾을 수 없습니다.
                      </p>
                    ) : (
                      <div className="space-y-4 text-sm">
                        <div className="grid grid-cols-[80px_1fr] gap-y-2">
                          <span className="text-muted-foreground">이름</span>
                          <span className="font-medium">{profile.instructor.name ?? "-"}</span>
                          <span className="text-muted-foreground">이메일</span>
                          <span className="font-medium break-all">
                            {profile.instructor.email ?? email ?? "-"}
                          </span>
                          <span className="text-muted-foreground">교육원</span>
                          <span className="font-medium">
                            {profile.instructor.all_branches
                              ? "전체 교육원"
                              : profile.instructor.branch ?? "-"}
                          </span>
                        </div>

                        <div>
                          <p className="mb-2 text-muted-foreground">허용된 기수</p>
                          {profile.instructor.cohorts.length ? (
                            <div className="flex flex-wrap gap-1.5">
                              {profile.instructor.cohorts.map((c) => (
                                <Badge key={c} variant="secondary">
                                  {c}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <p className="text-muted-foreground">없음</p>
                          )}
                        </div>

                        <div>
                          <p className="mb-2 text-muted-foreground">
                            배정된 수강반 ({profile.classes.length})
                          </p>
                          {profile.classes.length ? (
                            <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border/60 p-2">
                              {profile.classes.map((c) => (
                                <li key={c.id} className="flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-muted/60">
                                  <Link
                                    to="/admin/classes/$id"
                                    params={{ id: c.id }}
                                    onClick={() => setProfileOpen(false)}
                                    className="truncate font-medium hover:underline"
                                  >
                                    {c.name}
                                  </Link>
                                  {c.branch && (
                                    <span className="shrink-0 text-xs text-muted-foreground">{c.branch}</span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-muted-foreground">배정된 수강반이 없습니다.</p>
                          )}
                        </div>
                      </div>
                    )}
                  </DialogContent>
                </Dialog>
              )}


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
                <LogOut className="h-4 w-4 sm:mr-1" /> <span className="hidden sm:inline">로그아웃</span>
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
