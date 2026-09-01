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
import { createLocalInstructor } from "@/lib/vimeo.functions";
import { COHORT_OPTIONS } from "@/lib/cohort";
import { CohortMultiSelect } from "@/components/admin/CohortMultiSelect";

const BRANCHES = ["상동", "청라", "송도"];

const EMPTY = {
  name: "",
  email: "",
  phone: "",
  branch: "",
  tempPassword: "",
};

export function LocalInstructorDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [cohorts, setCohorts] = useState<string[]>([]);

  const set = (key: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  async function submit() {
    if (!form.name.trim()) {
      toast.error("이름을 입력해 주세요.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      toast.error("올바른 이메일을 입력해 주세요.");
      return;
    }
    setBusy(true);
    try {
      const res = await createLocalInstructor({ data: { ...form, cohorts } });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`강사가 등록되었습니다. 초기 비밀번호: ${res.initialPassword}`);
      setForm({ ...EMPTY });
      setCohorts([]);
      setOpen(false);
      onCreated();
    } catch (err: any) {
      toast.error(err?.message ?? "강사 등록에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <UserPlus className="h-4 w-4" />
          강사 직접 등록
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>강사 직접 등록</DialogTitle>
          <DialogDescription>
            강사 명부에 추가하고 이메일 기반 로그인 계정을 즉시 생성합니다. 초기 비밀번호는 첫
            로그인 시 변경하도록 안내됩니다.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>이름 *</Label>
            <Input value={form.name} onChange={set("name")} placeholder="홍길동" />
          </div>
          <div className="space-y-1.5">
            <Label>이메일 *</Label>
            <Input
              value={form.email}
              onChange={set("email")}
              placeholder="teacher@example.com"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label>전화번호</Label>
            <Input value={form.phone} onChange={set("phone")} placeholder="01012345678" />
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
            <Label>기수</Label>
            <CohortMultiSelect
              options={COHORT_OPTIONS}
              selected={cohorts}
              assignMode
              placeholder="미지정"
              allLabel="전체 기수"
              width="w-full"
              onChange={setCohorts}
            />
          </div>
          <div className="space-y-1.5">
            <Label>초기 비밀번호</Label>
            <Input
              value={form.tempPassword}
              onChange={set("tempPassword")}
              placeholder="미입력 시 12345678"
            />
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
