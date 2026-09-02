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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const COMMON_WEAK = [
  "12345678", "123456789", "1234567890", "password", "qwerty123",
  "abcd1234", "11111111", "00000000", "asdf1234", "1q2w3e4r",
];

/** 추측하기 쉬운 비밀번호인지 간단히 판단한다(차단이 아니라 경고용). */
function isWeakPassword(pw: string) {
  const v = pw.toLowerCase();
  if (COMMON_WEAK.includes(v)) return true;
  if (/^(.)\1+$/.test(v)) return true;
  if (/^\d+$/.test(v)) return true;
  if (/^[a-z]+$/.test(v)) return true;
  return false;
}

export const Route = createFileRoute("/change-password")({
  head: () => ({
    meta: [
      { title: "비밀번호 변경 — e-Learning" },
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
  const [weakConfirmOpen, setWeakConfirmOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) navigate({ to: "/login", replace: true });
    });
  }, [navigate]);

  const applyPassword = async () => {
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
        navigate({ to: "/", replace: true });
      }
    } catch (err: any) {
      toast.error(err.message ?? "비밀번호 변경에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

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
    if (isWeakPassword(pw1)) {
      setWeakConfirmOpen(true);
      return;
    }
    await applyPassword();
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

      <AlertDialog open={weakConfirmOpen} onOpenChange={setWeakConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>추측하기 쉬운 비밀번호입니다</AlertDialogTitle>
            <AlertDialogDescription>
              입력한 비밀번호는 다른 사람이 쉽게 추측할 수 있습니다. 그래도 이 비밀번호로 진행하시겠습니까?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>다시 입력</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setWeakConfirmOpen(false);
                await applyPassword();
              }}
            >
              이대로 진행
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
