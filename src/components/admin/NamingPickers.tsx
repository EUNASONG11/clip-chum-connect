import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { CANONICAL_BRANCHES } from "@/lib/branch";
import { COHORT_OPTIONS } from "@/lib/cohort";
import { PUBLISHER_OPTIONS } from "@/lib/publisher";
import { SUBJECT_OPTIONS } from "@/lib/subject";
import {
  buildNaesinClassName,
  parseNaesinClassName,
  buildRegularVideoTitle,
  parseRegularVideoTitle,
  VOCAB_SUBJECT,
  type RegularTitleParts,
} from "@/lib/naming";
import { listStudentFilterOptions } from "@/lib/classes.functions";
import { parseWeekLabel, MONTH_NUMBERS, WEEK_NUMBERS } from "@/lib/week";

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs transition",
        active ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

export function FormatWarningBadge({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-medium text-destructive", className)}>
      <AlertTriangle className="h-3 w-3" /> 형식 미준수
    </span>
  );
}

/** 내신 수강반 이름 선택기. 완성 시 onChange(이름, 교육원), 미완성 시 onChange(null, ...) */
export function NaesinClassNamePicker({
  initialName,
  onChange,
}: {
  initialName?: string | null;
  onChange: (name: string | null, branch: string | null) => void;
}) {
  const parsed = useMemo(() => parseNaesinClassName(initialName), [initialName]);
  const [branch, setBranch] = useState(parsed?.branch ?? "");
  const [cohort, setCohort] = useState(parsed?.cohort ?? "");
  const [mode, setMode] = useState<"school" | "publisher">(
    parsed && PUBLISHER_OPTIONS.includes(parsed.target) ? "publisher" : "school",
  );
  const [target, setTarget] = useState(parsed?.target ?? "");
  const [customPublisher, setCustomPublisher] = useState(
    !!parsed?.target && !PUBLISHER_OPTIONS.includes(parsed.target),
  );
  const [customSchool, setCustomSchool] = useState(false);
  const [schoolQuery, setSchoolQuery] = useState("");

  useEffect(() => {
    const p = parseNaesinClassName(initialName);
    setBranch(p?.branch ?? "");
    setCohort(p?.cohort ?? "");
    setTarget(p?.target ?? "");
    setMode(p && PUBLISHER_OPTIONS.includes(p.target) ? "publisher" : "school");
    setCustomPublisher(!!p?.target && !PUBLISHER_OPTIONS.includes(p.target));
    setCustomSchool(false);
  }, [initialName]);

  const { data: opts } = useQuery({
    queryKey: ["admin", "student-filter-options"],
    queryFn: () => listStudentFilterOptions(),
    staleTime: 5 * 60_000,
  });
  const allSchools: string[] = useMemo(() => {
    const by = (opts as any)?.schoolsByBranch ?? {};
    return branch ? (by[branch] ?? Object.entries(by).find(([k]) => k.includes(branch))?.[1] ?? []) : [];
  }, [opts, branch]);
  const schools: string[] = useMemo(() => {
    const q = schoolQuery.replace(/\s+/g, "");
    return q ? allSchools.filter((s) => s.replace(/\s+/g, "").includes(q)) : allSchools;
  }, [allSchools, schoolQuery]);

  // 기존 이름의 학교가 목록에 없으면 자동으로 "직접 입력" 상태로 전환
  useEffect(() => {
    if (mode === "school" && branch && target && allSchools.length > 0 && !allSchools.includes(target)) {
      setCustomSchool(true);
    }
  }, [allSchools, mode, branch, target]);


  const name = buildNaesinClassName({ branch, cohort, target });
  useEffect(() => {
    onChange(name, branch || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, branch]);

  const unformatted = !!initialName?.trim() && !parsed;

  return (
    <div className="space-y-3 rounded-md border p-3">
      {unformatted && (
        <div className="flex items-center gap-2 text-xs text-destructive">
          <FormatWarningBadge /> 현재 이름 "{initialName}"은 형식에 맞지 않습니다. 아래에서 다시 선택하면 덮어씁니다.
        </div>
      )}
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">교육원</p>
        <div className="flex flex-wrap gap-1.5">
          {CANONICAL_BRANCHES.map((b) => (
            <Chip key={b} active={branch === b} onClick={() => { setBranch(b); if (mode === "school") setTarget(""); }}>{b}</Chip>
          ))}
        </div>
      </div>
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">기수</p>
        <div className="flex flex-wrap gap-1.5">
          {COHORT_OPTIONS.map((c) => (
            <Chip key={c} active={cohort === c} onClick={() => setCohort(c)}>{c}</Chip>
          ))}
        </div>
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <p className="text-xs font-medium text-muted-foreground">구분</p>
          <Chip active={mode === "school"} onClick={() => { setMode("school"); setTarget(""); setCustomPublisher(false); }}>학교</Chip>
          <Chip active={mode === "publisher"} onClick={() => { setMode("publisher"); setTarget(""); setCustomPublisher(false); }}>출판사</Chip>
        </div>
        {mode === "publisher" ? (
          <div className="space-y-1.5">
            <div className="flex flex-wrap gap-1.5">
              {PUBLISHER_OPTIONS.map((p) => (
                <Chip key={p} active={!customPublisher && target === p} onClick={() => { setCustomPublisher(false); setTarget(p); }}>{p}</Chip>
              ))}
              <Chip active={customPublisher} onClick={() => { setCustomPublisher(true); setTarget(""); }}>직접 입력</Chip>
            </div>
            {customPublisher && (
              <Input
                className="h-8"
                placeholder="출판사 이름 직접 입력"
                maxLength={30}
                value={target}
                onChange={(e) => setTarget(e.target.value.replace(/[-[\]]/g, ""))}
              />
            )}
          </div>
        ) : !branch ? (
          <p className="text-xs text-muted-foreground">교육원을 먼저 선택하세요.</p>
        ) : (
          <div className="space-y-1.5">
            <Input className="h-8" placeholder="학교 검색" value={schoolQuery} onChange={(e) => setSchoolQuery(e.target.value)} />
            <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
              {schools.length === 0 ? (
                <p className="text-xs text-muted-foreground">학교가 없습니다.</p>
              ) : (
                schools.map((s) => (
                  <Chip key={s} active={target === s} onClick={() => setTarget(s)}>{s}</Chip>
                ))
              )}
            </div>
          </div>
        )}
      </div>
      <div className="rounded bg-muted px-3 py-2 text-sm">
        <span className="text-xs text-muted-foreground">미리보기: </span>
        {name ? <b>{name}</b> : <span className="text-muted-foreground">모든 항목을 선택하세요</span>}
      </div>
    </div>
  );
}

/** 정규 영상 제목 선택기. 완성 시 onChange(제목, 주차라벨|undefined) — 어휘는 주차 라벨 undefined(변경 안 함) */
export function RegularVideoTitlePicker({
  initialTitle,
  initialWeekLabel,
  onChange,
}: {
  initialTitle?: string | null;
  initialWeekLabel?: string | null;
  onChange: (title: string | null, weekLabel: string | undefined) => void;
}) {
  const init = useMemo(() => parseRegularVideoTitle(initialTitle), [initialTitle]);
  const wk = initialWeekLabel ? parseWeekLabel(initialWeekLabel) : null;
  const [subject, setSubject] = useState(init ? (init.kind === "vocab" ? VOCAB_SUBJECT : init.subject) : "");
  const [month, setMonth] = useState<number | null>(init?.kind === "general" ? init.month : wk?.month ?? null);
  const [week, setWeek] = useState<number | null>(init?.kind === "general" ? init.week : wk?.week ?? null);
  const [content, setContent] = useState(init?.kind === "general" ? init.content : "");
  const [lecture, setLecture] = useState<number>(init?.kind === "vocab" ? init.lecture : 1);

  const isVocab = subject === VOCAB_SUBJECT;
  const parts: RegularTitleParts | null = !subject
    ? null
    : isVocab
      ? { kind: "vocab", lecture }
      : month && week
        ? { kind: "general", month, week, subject, content }
        : null;
  const title = buildRegularVideoTitle(parts);
  const weekLabel =
    !isVocab && month && week ? `${new Date().getFullYear()}-${String(month).padStart(2, "0")}-${week}` : undefined;

  useEffect(() => {
    onChange(title, isVocab ? undefined : weekLabel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, weekLabel, isVocab]);

  const unformatted = !!initialTitle?.trim() && !init;

  return (
    <div className="space-y-3 rounded-md border p-3">
      {unformatted && (
        <div className="flex items-center gap-2 text-xs text-destructive">
          <FormatWarningBadge /> 현재 제목 "{initialTitle}"은 형식에 맞지 않습니다.
        </div>
      )}
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">과목</p>
        <div className="flex flex-wrap gap-1.5">
          {SUBJECT_OPTIONS.map((s) => (
            <Chip key={s} active={subject === s} onClick={() => setSubject(s)}>{s}</Chip>
          ))}
        </div>
      </div>
      {subject && !isVocab && (
        <>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">월</p>
            <div className="flex flex-wrap gap-1.5">
              {MONTH_NUMBERS.map((m) => (
                <Chip key={m} active={month === m} onClick={() => setMonth(m)}>{m}월</Chip>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">주차</p>
            <div className="flex flex-wrap gap-1.5">
              {WEEK_NUMBERS.map((w) => (
                <Chip key={w} active={week === w} onClick={() => setWeek(w)}>{w}주차</Chip>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">내용 (필수)</p>
            <Input value={content} maxLength={150} onChange={(e) => setContent(e.target.value)} placeholder="예) 관계대명사 심화" />
          </div>
        </>
      )}
      {isVocab && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">강 번호</p>
          <div className="flex items-center gap-2">
            <Button type="button" size="icon" variant="outline" className="h-8 w-8" onClick={() => setLecture((n) => Math.max(1, n - 1))}>
              <Minus className="h-4 w-4" />
            </Button>
            <Input
              type="number"
              min={1}
              className="h-8 w-20 text-center"
              value={lecture}
              onChange={(e) => setLecture(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            />
            <Button type="button" size="icon" variant="outline" className="h-8 w-8" onClick={() => setLecture((n) => n + 1)}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
      <div className="rounded bg-muted px-3 py-2 text-sm">
        <span className="text-xs text-muted-foreground">미리보기: </span>
        {title ? <b>{title}</b> : <span className="text-muted-foreground">모든 항목을 선택·입력하세요</span>}
      </div>
    </div>
  );
}
