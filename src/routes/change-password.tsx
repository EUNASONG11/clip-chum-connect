import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { clearMyMustChangePassword, getMyStatus } from "@/lib/vimeo.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Eye, EyeOff, KeyRound } from "lucide-react";

export const Route = createFileRoute("/change-password")({
  head: () => ({
    meta: [
      { title: "비밀번호 변경 — VimStream" },
      { name: "description", content: "최초 로그인 시 비밀번호를 변경하세요." },
    ],
  }),
  component: ChangePasswordPage,
});

function ChangePasswordPage() {
  const navigate = useNavigate();
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [showPw1, setShowPw1] = useState(false);
  const [showPw2, setShowPw2] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) navigate({ to: "/login", replace: true });
    });
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw1.length < 8) {
      toast.error("비밀번호는 8자 이상이어야 합니다.");
      return;
    }
    if (pw1 !== pw2) {
      toast.error("비밀번호가 일치하지 않습니다.");
      return;
    }
    if (pw1 === "12345678") {
      toast.error("초기 비밀번호와 다른 비밀번호를 사용하세요.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw1 });
      if (error) throw error;
      await clearMyMustChangePassword();
      toast.success("비밀번호가 변경되었습니다.");
      try {
        const s = await getMyStatus();
        navigate({ to: s.isAdmin || s.isInstructor ? "/admin" : "/", replace: true });
      } catch {
        navigate({ to: "/admin", replace: true });
      }
    } catch (err: any) {
      toast.error(err.message ?? "비밀번호 변경에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <KeyRound className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="mt-3">비밀번호 변경</CardTitle>
          <p className="mt-2 text-sm text-muted-foreground">
            최초 로그인입니다. 새 비밀번호를 설정하세요.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <div>
              <Label htmlFor="pw1">새 비밀번호</Label>
              <div className="relative">
                <Input
                  id="pw1"
                  type={showPw1 ? "text" : "password"}
                  minLength={8}
                  required
                  value={pw1}
                  onChange={(e) => setPw1(e.target.value)}
                  placeholder="8자 이상"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPw1((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showPw1 ? "비밀번호 숨기기" : "비밀번호 보기"}
                >
                  {showPw1 ? <Eye size={18} /> : <EyeOff size={18} />}
                </button>
              </div>
            </div>
            <div>
              <Label htmlFor="pw2">새 비밀번호 확인</Label>
              <div className="relative">
                <Input
                  id="pw2"
                  type={showPw2 ? "text" : "password"}
                  minLength={8}
                  required
                  value={pw2}
                  onChange={(e) => setPw2(e.target.value)}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPw2((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showPw2 ? "비밀번호 숨기기" : "비밀번호 보기"}
                >
                  {showPw2 ? <Eye size={18} /> : <EyeOff size={18} />}
                </button>
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "처리 중..." : "비밀번호 변경"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
