export const COHORT_OPTIONS = ["19기", "18기", "17기", "16기", "15기", "14기", "13기"];

/**
 * 마스터 DB의 기수 규칙
 *
 * 학생의 기수는 students.teacher_id → teachers.email 로 정해진다.
 *   sdljs-17@gmail.com → 상동 17기
 *   ljs-17@gmail.com   → 청라 17기
 *   soljs-16@gmail.com → 송도 16기
 * 예외: ljs-09@gmail.com 은 청라 14기.
 *
 * students.cohort_override 가 있으면(예: "15기", "15") 그 값을 우선한다.
 */

// 이메일 번호와 실제 기수가 다른 계정 (이메일 로컬파트 → 기수 번호)
const EMAIL_COHORT_EXCEPTIONS: Record<string, number> = {
  "ljs-09": 14,
};

const PREFIX_BRANCH: Record<string, string> = {
  sd: "상동",
  so: "송도",
  "": "청라",
};

export type TeacherCohort = { branch: string; cohort: string };

/** 강사 이메일에서 교육원·기수를 읽는다. 형식이 다르면 null. */
export function cohortFromTeacherEmail(email: string | null | undefined): TeacherCohort | null {
  if (!email) return null;
  const local = email.trim().toLowerCase().split("@")[0] ?? "";
  const m = /^(sd|so)?ljs-(\d{1,3})$/.exec(local);
  if (!m) return null;
  const branch = PREFIX_BRANCH[m[1] ?? ""];
  const num = EMAIL_COHORT_EXCEPTIONS[local] ?? parseInt(m[2], 10);
  if (!branch || !Number.isFinite(num) || num <= 0) return null;
  return { branch, cohort: `${num}기` };
}

/** cohort_override("15기", "15") → "15기" */
export function cohortFromOverride(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const m = /(\d+)/.exec(String(raw));
  return m ? `${parseInt(m[1], 10)}기` : null;
}

/** override 우선, 없으면 강사 이메일 규칙. 둘 다 없으면 null. */
export function resolveStudentCohort(input: {
  cohortOverride?: unknown;
  teacherEmail?: string | null;
}): string | null {
  return cohortFromOverride(input.cohortOverride) ?? cohortFromTeacherEmail(input.teacherEmail)?.cohort ?? null;
}
