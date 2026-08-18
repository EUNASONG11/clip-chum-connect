/**
 * 주차 라벨 유틸 (월 기준 주차)
 * 저장 형식: "YYYY-MM-W"  예) "2026-08-1" = 2026년 8월 1주차
 * 주차 계산: 해당 월의 1일이 포함된 주를 1주차로 보고, 월요일 시작 주(월~일) 기준으로 계산
 */

export const WEEK_LABEL_RE = /^\d{4}-\d{2}-[1-5]$/;

export function isWeekLabel(v: unknown): v is string {
  return typeof v === "string" && WEEK_LABEL_RE.test(v);
}

export function makeWeekLabel(year: number, month: number, week: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${week}`;
}

export function parseWeekLabel(label: string): { year: number; month: number; week: number } | null {
  if (!isWeekLabel(label)) return null;
  const [y, m, w] = label.split("-");
  return { year: Number(y), month: Number(m), week: Number(w) };
}

/** 화면 표기: "8월 1주차" (연도가 올해와 다르면 "2025년 8월 1주차") */
export function formatWeekLabel(label: string | null | undefined): string {
  const p = label ? parseWeekLabel(label) : null;
  if (!p) return "주차 미지정";
  const nowYear = new Date().getFullYear();
  const prefix = p.year === nowYear ? "" : `${p.year}년 `;
  return `${prefix}${p.month}월 ${p.week}주차`;
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

/** 그 날짜가 속한 주(월~일)의 월요일 */
function mondayOf(d: Date): Date {
  const offset = (d.getDay() + 6) % 7; // 0=월 … 6=일
  return addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -offset);
}

/** 해당 월의 첫 번째 토요일이 속한 주의 월요일 = 1주차 월요일 */
function firstWeekMonday(year: number, month: number): Date {
  const first = new Date(year, month - 1, 1);
  const delta = (6 - first.getDay() + 7) % 7; // 첫 토요일까지
  const firstSaturday = addDays(first, delta);
  return mondayOf(firstSaturday);
}

/**
 * 날짜(YYYY-MM-DD 또는 Date) → 주차 라벨
 * "토요일 기준 주차": 그 주의 토요일이 속한 월을 기준 월로 삼고,
 * 그 월의 첫 토요일이 있는 주를 1주차로 센다.
 */
export function weekLabelFromDate(input: Date | string = new Date()): string {
  const d = typeof input === "string" ? new Date(`${input}T00:00:00`) : new Date(input);
  const monday = mondayOf(d);
  const saturday = addDays(monday, 5);
  const year = saturday.getFullYear();
  const month = saturday.getMonth() + 1;
  const base = firstWeekMonday(year, month);
  const week = Math.round((monday.getTime() - base.getTime()) / 86400000 / 7) + 1;
  return makeWeekLabel(year, month, Math.min(5, Math.max(1, week)));
}

/** 주차의 시작(월)/종료(일) 날짜 — 월 경계를 넘을 수 있음 */
export function weekRange(label: string): { start: string; end: string } {
  const p = parseWeekLabel(label);
  if (!p) {
    const t = toISODate(new Date());
    return { start: t, end: t };
  }
  const monday = addDays(firstWeekMonday(p.year, p.month), (p.week - 1) * 7);
  return { start: toISODate(monday), end: toISODate(addDays(monday, 6)) };
}

/**
 * 외부 시스템 전송용 기간 (월~토).
 * 주차 판정 기준일인 토요일까지만 보내 다음 주차로 밀리는 것을 방지한다.
 */
export function weekRangeForExternal(label: string): { start: string; end: string } {
  const { start } = weekRange(label);
  const s = new Date(`${start}T00:00:00`);
  return { start, end: toISODate(addDays(s, 5)) };
}

/** 주차 안의 주말(토, 일) 날짜 — 외부 과제 기간 기본값 */
export function weekendRange(label: string): { start: string; end: string } {
  const { start, end } = weekRange(label);
  const s = new Date(`${start}T00:00:00`);
  return { start: toISODate(addDays(s, 5)), end };
}

/** 최근 라벨이 먼저 오도록 비교 */
export function compareWeekLabelDesc(a: string, b: string): number {
  return b.localeCompare(a);
}

/** 선택 UI용 연/월/주차 옵션 */
export const WEEK_NUMBERS = [1, 2, 3, 4, 5];

export function yearOptions(span = 2): number[] {
  const y = new Date().getFullYear();
  const out: number[] = [];
  for (let i = y - span; i <= y + 1; i++) out.push(i);
  return out;
}

export const MONTH_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
