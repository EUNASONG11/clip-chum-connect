import { useState } from "react";
import { toast } from "sonner";
import { UserPlus, Loader2 } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createLocalStudent } from "@/lib/vimeo.functions";

const BRANCHES = ["상동", "청라", "송도"];

const EMPTY = {
  name: "",
  phone: "",
  parentPhone: "",
  branch: "",
  school: "",
  grade: "",
  tempPassword: "",
};

export function LocalStudentDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });

  const set = (key: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  async function submit() {
    if (!form.name.trim()) {
      toast.error("이름을 입력해 주세요.");
      return;
    }
    setBusy(true);
    try {
      const res = await createLocalStudent({ data: form });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`학생이 등록되었습니다. 초기 비밀번호: ${res.initialPassword}`);
      setForm({ ...EMPTY });
      setOpen(false);
      onCreated();
    } catch (err: any) {
      toast.error(err?.message ?? "학생 등록에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <UserPlus className="h-4 w-4" />
          학생 직접 등록
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>학생 직접 등록</DialogTitle>
          <DialogDescription>
            외부 시스템과 연동되지 않는 자체 학생 계정을 만듭니다. 이후 외부 동기화의 영향을 받지
            않습니다.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>이름 *</Label>
            <Input value={form.name} onChange={set("name")} placeholder="홍길동" />
          </div>
          <div className="space-y-1.5">
            <Label>전화번호</Label>
            <Input value={form.phone} onChange={set("phone")} placeholder="01012345678" />
          </div>
          <div className="space-y-1.5">
            <Label>학부모 전화번호</Label>
            <Input
              value={form.parentPhone}
              onChange={set("parentPhone")}
              placeholder="01087654321"
            />
          </div>
          <div className="space-y-1.5">
            <Label>교육원</Label>
            <Select
              value={form.branch}
              onValueChange={(value) => setForm((prev) => ({ ...prev, branch: value }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="교육원 선택" />
              </SelectTrigger>
              <SelectContent>
                {BRANCHES.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>학교</Label>
            <Input value={form.school} onChange={set("school")} />
          </div>
          <div className="space-y-1.5">
            <Label>학년</Label>
            <Input value={form.grade} onChange={set("grade")} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>임시 비밀번호 (전화번호가 없을 때)</Label>
            <Input
              value={form.tempPassword}
              onChange={set("tempPassword")}
              placeholder="예: 12345678"
            />
            <p className="text-xs text-muted-foreground">
              전화번호가 있으면 뒤 8자리가 초기 비밀번호로 사용됩니다. 없을 경우 임시 비밀번호를
              입력하면 이름 + 임시 비밀번호로 로그인할 수 있습니다.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            취소
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            등록
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
