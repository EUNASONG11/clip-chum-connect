import { createContext, useContext } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";

type RoleState = {
  isAdmin: boolean;
  isInstructor: boolean;
  isLoading: boolean;
};

export const AdminRoleContext = createContext<RoleState>({
  isAdmin: false,
  isInstructor: false,
  isLoading: true,
});

export function useAdminRole() {
  return useContext(AdminRoleContext);
}

export function AdminOnly({ children }: { children: React.ReactNode }) {
  const { isAdmin, isLoading } = useAdminRole();
  if (isLoading) {
    return <p className="p-6 text-muted-foreground">권한을 확인하는 중...</p>;
  }
  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-md p-10 text-center">
        <ShieldCheck className="mx-auto h-10 w-10 text-muted-foreground" />
        <h2 className="mt-4 text-xl font-semibold">관리자 권한이 필요합니다.</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          이 메뉴는 관리자만 접근할 수 있습니다.
        </p>
        <Button asChild variant="outline" className="mt-4">
          <Link to="/admin/dashboard">대시보드로</Link>
        </Button>
      </div>
    );
  }
  return <>{children}</>;
}
