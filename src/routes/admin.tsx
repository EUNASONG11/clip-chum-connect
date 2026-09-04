import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ShieldCheck, Upload as UploadIcon, Film, Users, GraduationCap, BarChart3, UsersRound, Trash2, Megaphone } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { getMyStatus, claimAdminIfNone, ensureStudentRole } from "@/lib/vimeo.functions";
import { AdminRoleContext, useAdminRole } from "@/components/AdminRole";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "관리자 — e-Learning" }] }),
  component: AdminLayout,
});

const adminNavItems = [
  { title: "대시보드", url: "/admin/dashboard", icon: BarChart3 },
  { title: "영상 관리", url: "/admin/videos", icon: Film },
  { title: "수강반 관리", url: "/admin/classes", icon: GraduationCap },
  
  { title: "사용자 관리", url: "/admin/users", icon: Users },
  { title: "강사 명부", url: "/admin/instructors", icon: GraduationCap },
  { title: "공지사항", url: "/admin/notices", icon: Megaphone },
  { title: "휴지통", url: "/admin/trash", icon: Trash2 },
];

const branchAdminNavItems = [
  { title: "대시보드", url: "/admin/dashboard", icon: BarChart3 },
  { title: "영상 관리", url: "/admin/videos", icon: Film },
  { title: "수강반 관리", url: "/admin/classes", icon: GraduationCap },
  { title: "사용자 관리", url: "/admin/users", icon: Users },
  { title: "강사 명부", url: "/admin/instructors", icon: GraduationCap },
  { title: "공지사항", url: "/admin/notices", icon: Megaphone },
];

const instructorNavItems = [
  { title: "대시보드", url: "/admin/dashboard", icon: BarChart3 },
  { title: "영상 관리", url: "/admin/videos", icon: Film },
  { title: "수강반 관리", url: "/admin/classes", icon: GraduationCap },
];

function AdminSidebar() {
  const currentPath = useRouterState({ select: (r) => r.location.pathname });
  const { state, setOpenMobile } = useSidebar();
  const isExpanded = state === "expanded";
  const { isAdmin, isInstructor, isBranchAdmin } = useAdminRole();
  const items = isAdmin ? adminNavItems : isBranchAdmin ? branchAdminNavItems : instructorNavItems;
  const label = isAdmin
    ? "관리자"
    : isBranchAdmin
      ? "교육원 관리자"
      : isInstructor
        ? "강사"
        : "메뉴";
  const badgeText = isAdmin ? "관리자" : isBranchAdmin ? "교육원 관리자" : isInstructor ? "강사" : "";

  const handleNavClick = () => {
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setOpenMobile(false);
    }
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader
        className={`flex h-12 !flex-row items-center border-b border-sidebar-border ${
          isExpanded ? "justify-between px-3" : "justify-center"
        }`}
      >
        {isExpanded && badgeText && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
            {badgeText}
          </span>
        )}
        <SidebarTrigger />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{label}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={currentPath === item.url}>
                    <Link to={item.url} className="flex items-center gap-2" onClick={handleNavClick}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

function AdminLayout() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isInstructor, setIsInstructor] = useState(false);
  const [isBranchAdmin, setIsBranchAdmin] = useState(false);
  const [branch, setBranch] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData.user) {
        await supabase.auth.signOut().catch(() => {});
        navigate({ to: "/login" });
        return;
      }
      try {
        try { await ensureStudentRole(); } catch {}
        const s = await getMyStatus();
        if (s.isAdmin || s.isInstructor || (s as any).isBranchAdmin) {
          setIsAdmin(s.isAdmin);
          setIsInstructor(s.isInstructor);
          setIsBranchAdmin(Boolean((s as any).isBranchAdmin));
          setBranch(((s as any).branch as string | null) ?? null);
        } else if (s.isStudent) {
          // 학생 계정은 관리자 화면 대신 홈으로
          navigate({ to: "/", replace: true });
          return;
        } else {
          const c = await claimAdminIfNone();
          if (c.claimed) {
            toast.success("첫 관리자로 등록되었습니다.");
            setIsAdmin(true);
          } else {
            setIsAdmin(false);
            setIsInstructor(false);
          }
        }
      } catch (e: any) {
        if (String(e?.message ?? "").includes("Unauthorized")) {
          await supabase.auth.signOut().catch(() => {});
          navigate({ to: "/login" });
          return;
        }
      } finally {
        setChecking(false);
      }
    })();
  }, [navigate]);

  if (checking) {
    return (
      <div className="min-h-screen">
        <SiteHeader />
        <p className="p-10 text-muted-foreground">확인 중...</p>
      </div>
    );
  }

  if (!isAdmin && !isInstructor && !isBranchAdmin) {
    return (
      <div className="min-h-screen">
        <SiteHeader />
        <div className="mx-auto max-w-md p-10 text-center">
          <ShieldCheck className="mx-auto h-10 w-10 text-muted-foreground" />
          <h2 className="mt-4 text-xl font-semibold">관리자 권한이 없습니다.</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            관리자에게 권한 부여를 요청하세요.
          </p>
          <Button asChild variant="outline" className="mt-4">
            <Link to="/">홈으로</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <AdminRoleContext.Provider value={{ isAdmin, isInstructor, isBranchAdmin, branch, isLoading: false }}>
      <SidebarProvider>
        <div className="flex min-h-screen w-full bg-background">
          <AdminSidebar />
          <div className="flex flex-1 flex-col min-w-0">
            <MobileHeader />
            <SiteHeader />
            <main className="flex-1 p-3 md:p-6">
              <div className="mx-auto max-w-5xl">
                <Outlet />
              </div>
            </main>
          </div>
        </div>
      </SidebarProvider>
    </AdminRoleContext.Provider>
  );
}

function MobileHeader() {
  const { isAdmin, isInstructor, isBranchAdmin } = useAdminRole();
  const label = isAdmin ? "관리자" : isBranchAdmin ? "교육원 관리자" : isInstructor ? "강사" : "";

  return (
    <div className="flex items-center gap-2 border-b bg-card px-2 py-2 md:hidden">
      <SidebarTrigger />
      {label && <span className="text-sm font-semibold">{label}</span>}
    </div>
  );
}
