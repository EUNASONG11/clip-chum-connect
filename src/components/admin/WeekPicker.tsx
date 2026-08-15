import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MONTH_NUMBERS,
  WEEK_NUMBERS,
  makeWeekLabel,
  parseWeekLabel,
  weekLabelFromDate,
  yearOptions,
} from "@/lib/week";

/** 영상의 주차(월 기준) 선택 위젯 */
export function WeekPicker({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const parsed = value ? parseWeekLabel(value) : null;
  const fallback = parseWeekLabel(weekLabelFromDate())!;
  const cur = parsed ?? fallback;

  const set = (p: Partial<{ year: number; month: number; week: number }>) =>
    onChange(makeWeekLabel(p.year ?? cur.year, p.month ?? cur.month, p.week ?? cur.week));

  return (
    <div className="space-y-2 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <Label>주차 (외부 과제 점검 연결용)</Label>
        {value ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
            주차 해제
          </Button>
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={() => set({})}>
            주차 지정
          </Button>
        )}
      </div>
      {value ? (
        <div className="grid grid-cols-3 gap-2">
          <Select value={String(cur.year)} onValueChange={(v) => set({ year: Number(v) })}>
            <SelectTrigger id={`${id}-year`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {yearOptions().map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}년
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(cur.month)} onValueChange={(v) => set({ month: Number(v) })}>
            <SelectTrigger id={`${id}-month`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTH_NUMBERS.map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {m}월
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(cur.week)} onValueChange={(v) => set({ week: Number(v) })}>
            <SelectTrigger id={`${id}-week`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEEK_NUMBERS.map((w) => (
                <SelectItem key={w} value={String(w)}>
                  {w}주차
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          주차를 지정하지 않으면 외부 과제 점검 연동 대상에서 제외됩니다.
        </p>
      )}
    </div>
  );
}
