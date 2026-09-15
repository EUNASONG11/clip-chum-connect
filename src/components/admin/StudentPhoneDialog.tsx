import { useState } from "react";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { updateStudentPhone } from "@/lib/vimeo.functions";

type Props = {
  authUserId: string;
  name: string;
  phone: string;
  parentPhone: string;
  onSaved?: () => void;
};

export function StudentPhoneDialog({ authUserId, name, phone, parentPhone, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [p, setP] = useState(phone);
  const [pp, setPp] = useState(parentPhone);
  const [busy, setBusy] = useState(false);

  function reset(next: boolean) {
    if (next) {
      setP(phone);
      setPp(parentPhone);
    }
    setOpen(next);
  }

  async function save() {
    setBusy(true);
    try {
      const res = await updateStudentPhone({
        data: { authUserId, phone: p, parentPhone: pp },
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        res.newPassword
          ? `전화번호를 저장했습니다. 새 비밀번호는 ${res.newPassword} 입니다.`
          : "전화번호를 저장했습니다.",
      );
      setOpen(false);
      onSaved?.();
    } catch (e: any) {
      toast.error(e?.message ?? "저장에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-8 gap-1 px-2 text-xs" aria-label="번호 수정">
          <Pencil className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">번호 수정</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{name} 전화번호 수정</DialogTitle>
          <DialogDescription>
            로그인에 사용하는 번호입니다. 번호를 바꾸면 비밀번호도 새 번호 뒤 8자리로 변경됩니다.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="sp-phone">학생 전화번호</Label>
            <Input
              id="sp-phone"
              value={p}
              onChange={(e) => setP(e.target.value)}
              placeholder="01012345678"
              inputMode="numeric"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sp-parent">학부모 전화번호</Label>
            <Input
              id="sp-parent"
              value={pp}
              onChange={(e) => setPp(e.target.value)}
              placeholder="01098765432"
              inputMode="numeric"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            취소
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "저장 중..." : "저장"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
