/**
 * 주차 라벨 유틸 (월 기준 주차)
 * 저장 형식: "YYYY-MM-W"  예) "2026-08-1" = 2026년 8월 1주차
 * 주차 계산: 해당 월의 1일이 포함된 주를 1주차로 보고, 일요일 시작 주 기준으로 계산
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

/** 날짜(YYYY-MM-DD 또는 Date) → 주차 라벨 */
export function weekLabelFromDate(input: Date | string = new Date()): string {
  const d = typeof input === "string" ? new Date(`${input}T00:00:00`) : new Date(input);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const firstDow = new Date(year, d.getMonth(), 1).getDay(); // 0=일
  const week = Math.min(5, Math.floor((d.getDate() + firstDow - 1) / 7) + 1);
  return makeWeekLabel(year, month, week);
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 주차의 시작(일)/종료(토) 날짜. 월 경계를 넘지 않도록 잘라냄 */
export function weekRange(label: string): { start: string; end: string } {
  const p = parseWeekLabel(label);
  if (!p) {
    const t = toISODate(new Date());
    return { start: t, end: t };
  }
  const monthStart = new Date(p.year, p.month - 1, 1);
  const monthEnd = new Date(p.year, p.month, 0);
  const firstDow = monthStart.getDay();
  let startDay = (p.week - 1) * 7 - firstDow + 1;
  if (startDay < 1) startDay = 1;
  const start = new Date(p.year, p.month - 1, startDay);
  let endDay = p.week * 7 - firstDow;
  if (endDay > monthEnd.getDate()) endDay = monthEnd.getDate();
  const end = new Date(p.year, p.month - 1, Math.max(endDay, startDay));
  return { start: toISODate(start), end: toISODate(end) };
}

/** 주차 안의 주말(토, 일) 날짜 — 외부 과제 기간 기본값 */
export function weekendRange(label: string): { start: string; end: string } {
  const { start, end } = weekRange(label);
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  const saturdays: Date[] = [];
  for (const d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 6) saturdays.push(new Date(d));
  }
  const sat = saturdays[0];
  if (!sat) return { start, end };
  const sun = new Date(sat);
  sun.setDate(sun.getDate() + 1);
  return { start: toISODate(sat), end: toISODate(sun > e ? e : sun) };
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
