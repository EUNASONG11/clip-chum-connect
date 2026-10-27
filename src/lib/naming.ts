/**
 * 수강반 이름(내신) · 영상 제목(정규) 형식 규칙 — 생성/파싱을 한 곳에서 관리한다.
 * 내신 반 이름: "[교육원] 기수 - 학교(또는 출판사) - 내신"
 * 정규 영상 제목: "[n월 n주차] 과목 - 내용" / "어휘 n강" / "어휘 - 내용"
 */
import { CANONICAL_BRANCHES } from "@/lib/branch";

export type NaesinNameParts = { branch: string; cohort: string; target: string };

const NAESIN_RE = /^\[(상동|청라|송도)\] (\d{1,2}기) - (.+?) - 내신$/;

export function buildNaesinClassName(p: Partial<NaesinNameParts>): string | null {
  const branch = p.branch?.trim();
  const cohort = p.cohort?.trim();
  const target = p.target?.trim();
  if (!branch || !cohort || !target) return null;
  if (!(CANONICAL_BRANCHES as readonly string[]).includes(branch)) return null;
  return `[${branch}] ${cohort} - ${target} - 내신`;
}

export function parseNaesinClassName(name: string | null | undefined): NaesinNameParts | null {
  const m = (name ?? "").trim().match(NAESIN_RE);
  if (!m) return null;
  return { branch: m[1]!, cohort: m[2]!, target: m[3]!.trim() };
}

export function isValidNaesinClassName(name: string | null | undefined): boolean {
  return parseNaesinClassName(name) !== null;
}

export type RegularTitleParts =
  | { kind: "vocab"; mode: "lecture"; lecture: number }
  | { kind: "vocab"; mode: "custom"; content: string }
  | { kind: "general"; month: number; week: number; subject: string; content: string };

export const VOCAB_SUBJECT = "어휘";
const VOCAB_RE = /^어휘 (\d{1,3})강$/;
const VOCAB_CUSTOM_RE = /^어휘 - (.+)$/;
const GENERAL_RE = /^\[(\d{1,2})월 ([1-5])주차\] (.+?) - (.+)$/;

export function buildRegularVideoTitle(p: RegularTitleParts | null): string | null {
  if (!p) return null;
  if (p.kind === "vocab") {
    if (p.mode === "custom") {
      const content = p.content.trim();
      if (!content) return null;
      const title = `어휘 - ${content}`;
      return title.length > 200 ? null : title;
    }
    if (!Number.isInteger(p.lecture) || p.lecture < 1) return null;
    return `어휘 ${p.lecture}강`;
  }
  const subject = p.subject.trim();
  const content = p.content.trim();
  if (!subject || !content || subject === VOCAB_SUBJECT) return null;
  if (p.month < 1 || p.month > 12 || p.week < 1 || p.week > 5) return null;
  const t = `[${p.month}월 ${p.week}주차] ${subject} - ${content}`;
  return t.length > 200 ? null : t;
}

export function parseRegularVideoTitle(title: string | null | undefined): RegularTitleParts | null {
  const s = (title ?? "").trim();
  const v = s.match(VOCAB_RE);
  if (v) return { kind: "vocab", mode: "lecture", lecture: Number(v[1]) };
  const custom = s.match(VOCAB_CUSTOM_RE);
  const customContent = custom?.[1]?.trim();
  if (customContent) {
    if (s.length > 200) return null;
    return { kind: "vocab", mode: "custom", content: customContent };
  }
  const g = s.match(GENERAL_RE);
  if (g) {
    const month = Number(g[1]);
    if (month < 1 || month > 12) return null;
    if (g[3]!.trim() === VOCAB_SUBJECT) return null;
    return { kind: "general", month, week: Number(g[2]), subject: g[3]!.trim(), content: g[4]!.trim() };
  }
  return null;
}

export function isValidRegularVideoTitle(title: string | null | undefined): boolean {
  return parseRegularVideoTitle(title) !== null;
}
