// 교육원 표준 명칭 규칙
// 외부 DB에는 '부천 상동교육원 (상동로 113 ...)', '상동 교육원' 등 다양한 표기가 섞여 있어
// 화면에서는 항상 '상동 · 청라 · 송도' 3개로만 노출하고, 내부적으로 부분 일치 매칭한다.
export const CANONICAL_BRANCHES = ["상동", "청라", "송도"] as const;
export type CanonicalBranch = (typeof CANONICAL_BRANCHES)[number];

/** 임의의 교육원 문자열을 표준 명칭으로 변환 (매칭 실패 시 원본 trim 값) */
export function canonicalBranch(value?: string | null): string {
  const raw = (value ?? "").toString().trim();
  if (!raw) return "";
  return CANONICAL_BRANCHES.find((b) => raw.includes(b)) ?? raw;
}

/** 선택한 표준 교육원과 실제 값이 같은 교육원인지 판단 */
export function matchesBranch(selected: string, value?: string | null): boolean {
  return canonicalBranch(value) === canonicalBranch(selected);
}
