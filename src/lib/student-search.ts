// 학생 검색 공통 규칙
// - 검색어가 없거나 너무 짧으면(사실상 전체 조회) 조회하지 않는다.
// - 이름은 2자 이상, 숫자(전화번호)는 4자 이상만 검색을 허용한다.
export const MAX_STUDENT_SEARCH_RESULTS = 20;
export const PER_TOKEN_FETCH_LIMIT = 30;
export const MIN_NAME_LENGTH = 2;
export const MIN_PHONE_DIGITS = 4;

export type StudentSearchToken = { kind: "phone" | "name"; value: string };

export function parseStudentSearchTokens(query: string): StudentSearchToken[] {
  const tokens = query.split(/\s+/).map((t) => t.trim()).filter(Boolean);
  const parsed: StudentSearchToken[] = [];
  for (const token of tokens) {
    const digits = token.replace(/[^0-9]/g, "");
    const isPhone = digits.length > 0 && digits.length === token.replace(/[-\s]/g, "").length;
    if (isPhone) {
      if (digits.length >= MIN_PHONE_DIGITS) parsed.push({ kind: "phone", value: digits });
    } else if (token.length >= MIN_NAME_LENGTH) {
      parsed.push({ kind: "name", value: token });
    }
  }
  return parsed;
}

// 클라이언트에서 검색 실행 가능 여부 판단 (불필요한 요청 차단)
export function isSearchableStudentQuery(query: string): boolean {
  return parseStudentSearchTokens(query).length > 0;
}

export const STUDENT_SEARCH_HINT = "이름은 2자 이상, 전화번호는 숫자 4자 이상 입력해 주세요.";
