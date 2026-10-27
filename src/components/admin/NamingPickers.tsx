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
import { parseWeekLabel, makeWeekLabel, MONTH_NUMBERS, WEEK_NUMBERS } from "@/lib/week";

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
          <Chip active={mode === "school"} onClick={() => { setMode("school"); setTarget(""); setCustomPublisher(false); setCustomSchool(false); }}>학교</Chip>
          <Chip active={mode === "publisher"} onClick={() => { setMode("publisher"); setTarget(""); setCustomPublisher(false); setCustomSchool(false); }}>출판사</Chip>
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
              {schools.length === 0 && !customSchool ? (
                <p className="text-xs text-muted-foreground">학교가 없습니다.</p>
              ) : (
                schools.map((s) => (
                  <Chip key={s} active={!customSchool && target === s} onClick={() => { setCustomSchool(false); setTarget(s); }}>{s}</Chip>
                ))
              )}
              <Chip active={customSchool} onClick={() => { setCustomSchool(true); setTarget(""); setSchoolQuery(""); }}>직접 입력</Chip>
            </div>
            {customSchool && (
              <Input
                className="h-8"
                placeholder="학교 이름 직접 입력"
                maxLength={30}
                value={target}
                onChange={(e) => setTarget(e.target.value.replace(/[-[\]]/g, ""))}
              />
            )}
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

/**
 * 정규 영상 제목 선택기. 완성 시 onChange(제목, 주차라벨|undefined) — 어휘는 주차 라벨 undefined(변경 안 함)
 * weekLabel(외부 WeekPicker 값)을 받아 월/주차를 양방향으로 맞춘다. 연도는 weekLabel의 연도를 유지한다.
 */
export function RegularVideoTitlePicker({
  initialTitle,
  weekLabel: extWeekLabel,
  onChange,
  externalSubject,
  onSubjectPick,
  subjectHint,
}: {
  initialTitle?: string | null;
  /** 외부 주차 값(controlled). null이면 주차 미지정 → 일반 제목은 미완성 */
  weekLabel?: string | null;
  onChange: (title: string | null, weekLabel: string | undefined) => void;
  /** 외부(폴더 선택 등)에서 자동으로 지정한 과목 */
  externalSubject?: { value: string; seq: number } | null;
  /** 사용자가 과목 칩을 직접 클릭했을 때 */
  onSubjectPick?: (subject: string) => void;
  /** 과목 영역 아래 표시할 자동 선택 안내 */
  subjectHint?: string | null;
}) {
  const init = useMemo(() => parseRegularVideoTitle(initialTitle), [initialTitle]);
  const wk = extWeekLabel ? parseWeekLabel(extWeekLabel) : null;
  const [subject, setSubject] = useState(init ? (init.kind === "vocab" ? VOCAB_SUBJECT : init.subject) : "");
  const [month, setMonth] = useState<number | null>(wk?.month ?? (extWeekLabel === undefined && init?.kind === "general" ? init.month : null));
  const [week, setWeek] = useState<number | null>(wk?.week ?? (extWeekLabel === undefined && init?.kind === "general" ? init.week : null));
  const [content, setContent] = useState(init?.kind === "general" ? init.content : "");
  const [vocabMode, setVocabMode] = useState<"lecture" | "custom">(init?.kind === "vocab" ? init.mode : "lecture");
  const [vocabContent, setVocabContent] = useState(init?.kind === "vocab" && init.mode === "custom" ? init.content : "");
  const [lecture, setLecture] = useState<number | null>(init?.kind === "vocab" && init.mode === "lecture" ? init.lecture : null);

  useEffect(() => {
    if (externalSubject?.value) setSubject(externalSubject.value);
  }, [externalSubject?.seq, externalSubject?.value]);

  const isVocab = subject === VOCAB_SUBJECT;

  // 외부 주차(WeekPicker) 변경 → 월/주차 반영 (어휘는 연동 안 함)
  useEffect(() => {
    if (isVocab || extWeekLabel === undefined) return;
    const p = extWeekLabel ? parseWeekLabel(extWeekLabel) : null;
    setMonth(p?.month ?? null);
    setWeek(p?.week ?? null);
  }, [extWeekLabel, isVocab]);

  const parts: RegularTitleParts | null = !subject
    ? null
    : isVocab
      ? vocabMode === "custom"
        ? { kind: "vocab", mode: "custom", content: vocabContent }
        : lecture
          ? { kind: "vocab", mode: "lecture", lecture }
          : null
      : month && week
        ? { kind: "general", month, week, subject, content }
        : null;
  const title = buildRegularVideoTitle(parts);
  const baseYear = (extWeekLabel ? parseWeekLabel(extWeekLabel)?.year : null) ?? new Date().getFullYear();
  const weekLabel = !isVocab && month && week ? makeWeekLabel(baseYear, month, week) : undefined;

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
            <Chip key={s} active={subject === s} onClick={() => { setSubject(s); onSubjectPick?.(s); }}>{s}</Chip>
          ))}
        </div>
        {subjectHint && (
          <p className="rounded bg-primary/10 px-2 py-1 text-xs text-primary">✓ {subjectHint}</p>
        )}
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
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="어휘 제목 방식">
            <Button type="button" size="sm" variant={vocabMode === "lecture" ? "default" : "outline"} className="h-auto rounded-full px-3 py-1 text-xs" aria-pressed={vocabMode === "lecture"} onClick={() => setVocabMode("lecture")}>강 번호</Button>
            <Button type="button" size="sm" variant={vocabMode === "custom" ? "default" : "outline"} className="h-auto rounded-full px-3 py-1 text-xs" aria-pressed={vocabMode === "custom"} onClick={() => setVocabMode("custom")}>직접 입력</Button>
          </div>
          {vocabMode === "custom" ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">내용 (필수)</p>
              <Input aria-label="어휘 내용" required value={vocabContent} maxLength={150} onChange={(e) => setVocabContent(e.target.value)} placeholder="예) 고전 한자어 정리" />
            </div>
          ) : (
          <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">강 번호</p>
          <div className="flex items-center gap-2">
            <Button type="button" size="icon" variant="outline" className="h-8 w-8" onClick={() => setLecture((n) => Math.max(1, (n ?? 2) - 1))}>
              <Minus className="h-4 w-4" />
            </Button>
            <Input
              aria-label="어휘 강 번호"
              type="number"
              min={1}
              className="h-8 w-20 text-center"
              placeholder="-"
              value={lecture ?? ""}
              onChange={(e) => {
                const n = Math.floor(Number(e.target.value));
                setLecture(e.target.value === "" || !n ? null : Math.max(1, n));
              }}
            />
            <Button type="button" size="icon" variant="outline" className="h-8 w-8" onClick={() => setLecture((n) => (n ?? 0) + 1)}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          </div>
          )}
        </div>
      )}
      <div className="rounded bg-muted px-3 py-2 text-sm">
        <span className="text-xs text-muted-foreground">미리보기: </span>
        {title ? <b>{title}</b> : <span className="text-muted-foreground">모든 항목을 선택·입력하세요</span>}
      </div>
    </div>
  );
}
