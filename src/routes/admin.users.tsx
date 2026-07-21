import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { UserPlus, UserMinus, Loader2 } from "lucide-react";
import { listUsers, grantAdminByEmail, revokeAdmin } from "@/lib/vimeo.functions";

type UserRow = { id: string; email: string; created_at: string; roles: string[] };

const usersQueryOptions = queryOptions({
  queryKey: ["admin", "users"],
  queryFn: async () => (await listUsers()) as UserRow[],
  staleTime: 30_000,
});

export const Route = createFileRoute("/admin/users")({
  component: UsersPage,
});

function UsersPage() {
  const queryClient = useQueryClient();
  const { data: users = [], isFetching } = useQuery(usersQueryOptions);
  const [grantEmail, setGrantEmail] = useState("");
  const [granting, setGranting] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const patchRoles = (userId: string, updater: (roles: string[]) => string[]) => {
    queryClient.setQueryData<UserRow[]>(["admin", "users"], (prev) =>
      prev?.map((u) => (u.id === userId ? { ...u, roles: updater(u.roles) } : u)) ?? prev,
    );
  };

  const grantAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = grantEmail.trim();
    if (!email) return;
    setGranting(true);
    try {
      const res = await grantAdminByEmail({ data: { email } });
      patchRoles(res.userId, (roles) => (roles.includes("admin") ? roles : [...roles, "admin"]));
      toast.success("관리자 권한을 부여했습니다.");
      setGrantEmail("");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setGranting(false);
    }
  };

  const grantForRow = async (u: UserRow) => {
    setPendingId(u.id);
    try {
      await grantAdminByEmail({ data: { email: u.email } });
      patchRoles(u.id, (roles) => (roles.includes("admin") ? roles : [...roles, "admin"]));
      toast.success("관리자 권한을 부여했습니다.");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setPendingId(null);
    }
  };

  const removeAdmin = async (userId: string, email: string) => {
    if (!confirm(`${email} 의 관리자 권한을 회수하시겠습니까?`)) return;
    setPendingId(userId);
    try {
      await revokeAdmin({ data: { userId } });
      patchRoles(userId, (roles) => roles.filter((r) => r !== "admin"));
      toast.success("관리자 권한을 회수했습니다.");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setPendingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          사용자 관리 ({users.length})
          {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </CardTitle>
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
              const busy = pendingId === u.id;
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
                      disabled={busy}
                      onClick={() => removeAdmin(u.id, u.email)}
                    >
                      <UserMinus className="h-4 w-4" /> {busy ? "처리 중..." : "관리자 회수"}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1"
                      disabled={busy}
                      onClick={() => grantForRow(u)}
                    >
                      <UserPlus className="h-4 w-4" /> {busy ? "처리 중..." : "관리자 지정"}
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
