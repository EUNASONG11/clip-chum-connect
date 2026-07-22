import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ShieldCheck, Upload as UploadIcon, Film, Users, GraduationCap, BarChart3 } from "lucide-react";
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
import { getMyRole, claimAdminIfNone, ensureStudentRole } from "@/lib/vimeo.functions";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "관리자 — VimStream" }] }),
  component: AdminLayout,
});

const navItems = [
  { title: "대시보드", url: "/admin/dashboard", icon: BarChart3 },
  { title: "영상 업로드", url: "/admin/upload", icon: UploadIcon },
  { title: "등록된 영상", url: "/admin/videos", icon: Film },
  { title: "수강반 관리", url: "/admin/classes", icon: GraduationCap },
  { title: "사용자 관리", url: "/admin/users", icon: Users },
];

function AdminSidebar() {
  const currentPath = useRouterState({ select: (r) => r.location.pathname });
  const { state } = useSidebar();
  const isExpanded = state === "expanded";
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className={`flex h-12 flex-row items-center border-b border-sidebar-border ${isExpanded ? "justify-end pr-3" : "justify-center"}`}>
        <SidebarTrigger />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>관리자</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={currentPath === item.url}>
                    <Link to={item.url} className="flex items-center gap-2">
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

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        navigate({ to: "/login" });
        return;
      }
      try {
        try { await ensureStudentRole(); } catch {}
        const me = await getMyRole();
        if (!me.isAdmin) {
          const c = await claimAdminIfNone();
          if (c.claimed) {
            toast.success("첫 관리자로 등록되었습니다.");
            setIsAdmin(true);
          } else {
            setIsAdmin(false);
          }
        } else {
          setIsAdmin(true);
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

  if (!isAdmin) {
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
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AdminSidebar />
        <div className="flex flex-1 flex-col min-w-0">
          <SiteHeader />
          <main className="flex-1 p-6">
            <div className="mx-auto max-w-5xl">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
