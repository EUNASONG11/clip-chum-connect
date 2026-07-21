import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { UserPlus, UserMinus } from "lucide-react";
import { listUsers, grantAdminByEmail, revokeAdmin } from "@/lib/vimeo.functions";

export const Route = createFileRoute("/admin/users")({
  component: UsersPage,
});

type UserRow = { id: string; email: string; created_at: string; roles: string[] };

function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [grantEmail, setGrantEmail] = useState("");
  const [granting, setGranting] = useState(false);

  const loadUsers = async () => {
    try {
      const u = await listUsers();
      setUsers(u as UserRow[]);
    } catch (err: any) {
      toast.error(err.message ?? "사용자 목록을 불러올 수 없습니다.");
    }
  };

  useEffect(() => { loadUsers(); }, []);

  const grantAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!grantEmail.trim()) return;
    setGranting(true);
    try {
      await grantAdminByEmail({ data: { email: grantEmail.trim() } });
      toast.success("관리자 권한을 부여했습니다.");
      setGrantEmail("");
      loadUsers();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setGranting(false);
    }
  };

  const removeAdmin = async (userId: string, email: string) => {
    if (!confirm(`${email} 의 관리자 권한을 회수하시겠습니까?`)) return;
    try {
      await revokeAdmin({ data: { userId } });
      toast.success("관리자 권한을 회수했습니다.");
      loadUsers();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>사용자 관리 ({users.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <form onSubmit={grantAdmin} className="flex flex-col gap-2 sm:flex-row">
          <Input
            type="email"
            placeholder="관리자로 지정할 이메일"
            value={grantEmail}
            onChange={(e) => setGrantEmail(e.target.value)}
            required
          />
          <Button type="submit" disabled={granting} className="gap-1">
            <UserPlus className="h-4 w-4" />
            {granting ? "처리 중..." : "관리자 부여"}
          </Button>
        </form>
        {users.length === 0 ? (
          <p className="text-sm text-muted-foreground">사용자가 없습니다.</p>
        ) : (
          <ul className="divide-y">
            {users.map((u) => {
              const admin = u.roles.includes("admin");
              return (
                <li key={u.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{u.email || "(이메일 없음)"}</p>
                    <p className="text-xs text-muted-foreground">
                      역할:{" "}
                      <span className={admin ? "text-primary font-medium" : ""}>
                        {admin ? "관리자" : "학생"}
                      </span>
                    </p>
                  </div>
                  {admin ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      onClick={() => removeAdmin(u.id, u.email)}
                    >
                      <UserMinus className="h-4 w-4" /> 관리자 회수
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1"
                      onClick={async () => {
                        try {
                          await grantAdminByEmail({ data: { email: u.email } });
                          toast.success("관리자 권한을 부여했습니다.");
                          loadUsers();
                        } catch (err: any) {
                          toast.error(err.message);
                        }
                      }}
                    >
                      <UserPlus className="h-4 w-4" /> 관리자 지정
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
