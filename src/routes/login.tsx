import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  ensureStudentRole,
  getMyStatus,
  checkEmailExists,
  resolveStudentLogin,
  getMyMustChangePassword,
} from "@/lib/vimeo.functions";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Video, Eye, EyeOff } from "lucide-react";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "로그인 — VimStream" }] }),
  component: AuthPage,
});

async function routeByStatus(navigate: ReturnType<typeof useNavigate>) {
  try {
    // 강사 최초 로그인 시 비밀번호 변경 강제
    try {
      const mc = await getMyMustChangePassword();
      if (mc.mustChange) {
        navigate({ to: "/change-password", replace: true });
        return;
      }
    } catch {}
    const s = await getMyStatus();
    if (s.isPending) {
      toast.error("관리자 승인 대기 중입니다. 승인 후 이용 가능합니다.");
      await supabase.auth.signOut();
      return;
    }
    navigate({ to: s.isAdmin || s.isInstructor ? "/admin" : "/" });
  } catch {
    navigate({ to: "/" });
  }
}


function AuthPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"student" | "admin">("student");

  // 학생 로그인 (이름 + 전화번호)
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  // 관리자 로그인 (이메일 + 비밀번호)
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      await routeByStatus(navigate);
    });
  }, [navigate]);

  const submitStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { email: resolvedEmail, initialPassword } = await resolveStudentLogin({
        data: { name, phone },
      });
      const { error } = await supabase.auth.signInWithPassword({
        email: resolvedEmail,
        password: initialPassword,
      });
      if (error) {
        toast.error("로그인에 실패했습니다. 관리자에게 문의하세요.");
        return;
      }
      try {
        await ensureStudentRole();
      } catch {}
      await routeByStatus(navigate);
    } catch (err: any) {
      toast.error(err.message ?? "로그인 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const submitAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast.success("가입 완료! 관리자 승인 후 이용 가능합니다.");
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          const msg = (error.message ?? "").toLowerCase();
          if (msg.includes("invalid") || msg.includes("credentials")) {
            try {
              const { exists } = await checkEmailExists({ data: { email } });
              if (!exists) {
                toast.error("등록되지 않은 이메일입니다.");
              } else {
                toast.error("비밀번호가 올바르지 않습니다.");
              }
            } catch {
              toast.error("이메일 또는 비밀번호가 올바르지 않습니다.");
            }
            return;
          }
          throw error;
        }
        try {
          await ensureStudentRole();
        } catch {}
        await routeByStatus(navigate);
      }
    } catch (err: any) {
      toast.error(err.message ?? "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Video className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="mt-3">로그인</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={tab} onValueChange={(v) => setTab(v as "student" | "admin")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="student">학생</TabsTrigger>
              <TabsTrigger value="admin">관리자·강사</TabsTrigger>
            </TabsList>


            <TabsContent value="student" className="pt-4">
              <form onSubmit={submitStudent} className="space-y-3">
                <div>
                  <Label htmlFor="name">이름</Label>
                  <Input
                    id="name"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="홍길동"
                  />
                </div>
                <div>
                  <Label htmlFor="phone">전화번호</Label>
                  <Input
                    id="phone"
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="010-1234-5678"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "처리 중..." : "로그인"}
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  학원에 등록된 이름과 전화번호를 입력하세요.
                </p>
              </form>
            </TabsContent>

            <TabsContent value="admin" className="pt-4">
              <form onSubmit={submitAdmin} className="space-y-3">
                <div>
                  <Label htmlFor="email">이메일</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="password">비밀번호</Label>
                  <Input
                    id="password"
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "처리 중..." : mode === "signin" ? "로그인" : "가입하기"}
                </Button>
              </form>
              <button
                type="button"
                className="mt-3 w-full text-center text-sm text-muted-foreground hover:text-foreground"
                onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
              >
                {mode === "signin"
                  ? "계정이 없으신가요? 회원가입"
                  : "이미 계정이 있으신가요? 로그인"}
              </button>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
