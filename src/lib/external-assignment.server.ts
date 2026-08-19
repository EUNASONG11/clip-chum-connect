/**
 * 외부 "과제 점검" 프로젝트로 내보내는 HTTP 호출 모음 (서버 전용).
 *
 * 필요한 시크릿:
 *  - EXTERNAL_ASSIGNMENT_BASE_URL : 외부 프로젝트 Edge Function 베이스 URL
 *      예) https://<외부프로젝트>.supabase.co/functions/v1
 *  - EXTERNAL_SYNC_API_KEY        : 외부에서 발급한 x-api-key 값
 *
 * 엔드포인트(외부 프로젝트가 제공):
 *  - POST {BASE}/external-assignment-sync
 *  - POST {BASE}/external-assignment-complete
 */

export const EXTERNAL_SOURCE = "elearning";

type RemoteConfig = { baseUrl: string; apiKey: string };

function readConfig(): RemoteConfig {
  const baseUrl = process.env["EXTERNAL_ASSIGNMENT_BASE_URL"];
  const apiKey = process.env["EXTERNAL_SYNC_API_KEY"];
  if (!baseUrl || !apiKey) {
    const missing = [
      ...(!baseUrl ? ["EXTERNAL_ASSIGNMENT_BASE_URL"] : []),
      ...(!apiKey ? ["EXTERNAL_SYNC_API_KEY"] : []),
    ];
    throw new Error(
      `외부 과제 연동 설정이 없습니다: ${missing.join(", ")}. 외부 프로젝트에서 발급받은 값을 시크릿으로 저장해 주세요.`,
    );
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

export function isExternalAssignmentConfigured(): boolean {
  return !!process.env["EXTERNAL_ASSIGNMENT_BASE_URL"] && !!process.env["EXTERNAL_SYNC_API_KEY"];
}

async function post(path: string, body: unknown): Promise<{ ok: boolean; status: number; json: any; text: string }> {
  const { baseUrl, apiKey } = readConfig();
  const res = await fetch(`${baseUrl}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* 비-JSON 응답은 text로만 보관 */
  }
  return { ok: res.ok, status: res.status, json, text };
}

export type SyncPayload = {
  external_id: string;
  assignment_type: string;
  scope: "school" | "class" | "individual" | "teacher_group" | "time_group";
  target: Record<string, unknown>;
  period: { start: string; end: string };
  students: string[];
  /** 수강반 교육원 (없으면 모든 교육원 대상) */
  branch?: string | null;
  /** 학생별 교육원: { "마스터 students.id": "청라" } */
  student_branches?: Record<string, string | null>;
};


/** 과제 정의 생성/갱신 (upsert) */
export async function pushAssignmentSync(payload: SyncPayload) {
  const result = await post("external-assignment-sync", { source: EXTERNAL_SOURCE, ...payload });
  if (!result.ok) {
    throw new Error(`외부 과제 생성 실패 (${result.status}): ${result.text.slice(0, 300)}`);
  }
  const remoteId =
    result.json?.common_assignment_type_id ?? result.json?.data?.common_assignment_type_id ?? result.json?.id ?? null;
  return { remoteAssignmentTypeId: remoteId ? String(remoteId) : null, raw: result.json };
}

export type CompletePayload = {
  external_id: string;
  /** 마스터 students.id */
  student_id: string;
  assignment_type: string;
  status: string;
  memo?: string;
  occurred_at: string;
  /** 학생 교육원 (외부에서 담당 계정/필터 판정용) */
  branch?: string | null;
};


/** 학생 1명의 과제 상태를 완료로 갱신 */
export async function pushAssignmentComplete(payload: CompletePayload) {
  const result = await post("external-assignment-complete", { source: EXTERNAL_SOURCE, ...payload });
  if (!result.ok) {
    throw new Error(`외부 완료 통보 실패 (${result.status}): ${result.text.slice(0, 300)}`);
  }
  return { raw: result.json };
}
