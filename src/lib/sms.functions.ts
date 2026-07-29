import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// 교육원명 → 시크릿 접두어 매핑
const BRANCH_KEY: Record<string, string> = {
  상동: "SANGDONG",
  청라: "CHEONGNA",
  송도: "SONGDO",
};

function normalizeBranch(b: string | null | undefined): string | null {
  if (!b) return null;
  const t = b.trim();
  return BRANCH_KEY[t] ? t : null;
}

function normalizePhone(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.replace(/[^0-9]/g, "");
  if (s.length < 9 || s.length > 11) return null;
  return s;
}

async function assertAdminOrInstructorOnClass(
  context: { supabase: any; userId: string },
  classId: string,
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: adminData } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (adminData) return;
  const { data: cls } = await supabaseAdmin
    .from("classes")
    .select("created_by")
    .eq("id", classId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!cls) throw new Error("수강반을 찾을 수 없습니다.");
  if (cls.created_by === context.userId) return;
  const { data: assigned } = await supabaseAdmin
    .from("class_instructors")
    .select("class_id")
    .eq("class_id", classId)
    .eq("instructor_user_id", context.userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!assigned) throw new Error("이 수강반에 문자 전송 권한이 없습니다.");
}

// ---------- 미시청 학생 조회 ----------

export const listNonWatchers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        classId: z.string().uuid(),
        videoId: z.string().uuid().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdminOrInstructorOnClass(context, data.classId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: videos }, { data: students }, { data: history }] = await Promise.all([
      supabaseAdmin
        .from("videos")
        .select("id, title, created_at")
        .eq("class_id", data.classId)
        .is("deleted_at", null),
      supabaseAdmin
        .from("class_students")
        .select("user_id")
        .eq("class_id", data.classId)
        .is("deleted_at", null),
      supabaseAdmin
        .from("class_enrollment_history")
        .select("user_id, action, created_at")
        .eq("class_id", data.classId)
        .eq("action", "added"),
    ]);

    const studentIds = ((students ?? []) as any[]).map((s) => s.user_id);
    if (studentIds.length === 0) return [] as any[];

    const enrollStart = new Map<string, string>();
    ((history ?? []) as any[]).forEach((h) => {
      const prev = enrollStart.get(h.user_id);
      if (!prev || h.created_at > prev) enrollStart.set(h.user_id, h.created_at);
    });

    const videoList = ((videos ?? []) as any[]) as { id: string; title: string; created_at: string }[];

    // 대상 영상 목록
    let targetVideos: typeof videoList;
    if (data.videoId) {
      targetVideos = videoList.filter((v) => v.id === data.videoId);
      if (targetVideos.length === 0) throw new Error("영상을 찾을 수 없습니다.");
    } else {
      targetVideos = videoList;
    }
    const targetIds = targetVideos.map((v) => v.id);

    const { data: progress } =
      targetIds.length > 0
        ? await supabaseAdmin
            .from("video_progress")
            .select("video_id, user_id, is_completed")
            .in("video_id", targetIds)
        : { data: [] as any[] };
    const completedSet = new Set(
      ((progress ?? []) as any[])
        .filter((p: any) => p.is_completed)
        .map((p: any) => `${p.user_id}::${p.video_id}`),
    );

    const { data: ext } = await supabaseAdmin
      .from("external_students")
      .select("auth_user_id, name, phone, parent_phone, branch")
      .in("auth_user_id", studentIds);
    const extMap = new Map(((ext ?? []) as any[]).map((e: any) => [e.auth_user_id, e]));

    const result = studentIds
      .map((uid) => {
        const e: any = extMap.get(uid) ?? {};
        const start = enrollStart.get(uid);
        const eligible = data.videoId
          ? targetVideos
          : targetVideos.filter((v) => !start || v.created_at >= start);
        if (eligible.length === 0) return null;
        const incompleteCount = eligible.reduce(
          (n, v) => (completedSet.has(`${uid}::${v.id}`) ? n : n + 1),
          0,
        );
        if (incompleteCount === 0) return null;
        const phone = normalizePhone(e.phone) ?? normalizePhone(e.parent_phone);
        const phoneSource: "self" | "parent" | null = normalizePhone(e.phone)
          ? "self"
          : normalizePhone(e.parent_phone)
            ? "parent"
            : null;
        return {
          user_id: uid,
          name: (e.name as string) ?? "",
          phone: phone ?? "",
          phone_source: phoneSource,
          branch: (e.branch as string) ?? "",
          incomplete_count: incompleteCount,
          eligible_total: eligible.length,
        };
      })
      .filter(Boolean) as Array<{
      user_id: string;
      name: string;
      phone: string;
      phone_source: "self" | "parent" | null;
      branch: string;
      incomplete_count: number;
      eligible_total: number;
    }>;

    return result.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  });

// ---------- NCP SENS 발송 ----------

function getBranchCreds(branchKor: string) {
  const key = BRANCH_KEY[branchKor];
  if (!key) throw new Error(`지원되지 않는 교육원입니다: ${branchKor}`);
  const env = process.env;
  const accessKey = env[`NCP_${key}_ACCESS_KEY`];
  const secretKey = env[`NCP_${key}_SECRET_KEY`];
  if (!accessKey || !secretKey) throw new Error(`${branchKor} 교육원 NCP 인증키가 설정되지 않았습니다.`);
  return {
    accessKey,
    secretKey,
    smsServiceId: env[`NCP_${key}_SMS_SERVICE_ID`] ?? "",
    smsFrom: env[`NCP_${key}_SMS_FROM`] ?? "",
    btServiceId: env[`NCP_${key}_BRANDTALK_SERVICE_ID`] ?? "",
    btChannelId: env[`NCP_${key}_BRANDTALK_CHANNEL_ID`] ?? "",
  };
}

async function hmacBase64(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  let bin = "";
  new Uint8Array(sig).forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

async function sensHeaders(method: string, path: string, accessKey: string, secretKey: string) {
  const ts = Date.now().toString();
  const msg = `${method} ${path}\n${ts}\n${accessKey}`;
  const signature = await hmacBase64(secretKey, msg);
  return {
    "Content-Type": "application/json; charset=utf-8",
    "x-ncp-apigw-timestamp": ts,
    "x-ncp-iam-access-key": accessKey,
    "x-ncp-apigw-signature-v2": signature,
  };
}

function byteLen(s: string): number {
  // EUC-KR 근사치: ASCII 1바이트, 그 외 2바이트
  let n = 0;
  for (const ch of s) n += ch.charCodeAt(0) < 128 ? 1 : 2;
  return n;
}

const RecipientSchema = z.object({
  user_id: z.string().uuid(),
  name: z.string().default(""),
  phone: z.string().min(9),
  branch: z.string().min(1),
});

export const sendClassSms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        classId: z.string().uuid(),
        recipients: z.array(RecipientSchema).min(1).max(1000),
        message: z.string().min(1).max(2000),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdminOrInstructorOnClass(context, data.classId);

    // 교육원별로 그룹화
    const groups = new Map<string, typeof data.recipients>();
    for (const r of data.recipients) {
      const b = normalizeBranch(r.branch);
      if (!b) continue;
      const phone = normalizePhone(r.phone);
      if (!phone) continue;
      const arr = groups.get(b) ?? [];
      arr.push({ ...r, phone });
      groups.set(b, arr);
    }
    if (groups.size === 0) throw new Error("발송 가능한 수신자가 없습니다. (교육원 또는 전화번호 확인)");

    const isLms = byteLen(data.message) > 80;
    const results: Array<{ branch: string; count: number; ok: boolean; error?: string }> = [];
    const unknownBranches: string[] = [];

    for (const [branch, list] of groups) {
      try {
        const creds = getBranchCreds(branch);
        if (!creds.smsServiceId || !creds.smsFrom) {
          throw new Error(`${branch} SMS 서비스 ID 또는 발신번호가 설정되지 않았습니다.`);
        }
        const path = `/sms/v2/services/${creds.smsServiceId}/messages`;
        const headers = await sensHeaders("POST", path, creds.accessKey, creds.secretKey);
        // NCP는 요청당 1,000명 제한
        const chunks: (typeof list)[] = [];
        for (let i = 0; i < list.length; i += 900) chunks.push(list.slice(i, i + 900));
        for (const chunk of chunks) {
          const body = {
            type: isLms ? "LMS" : "SMS",
            contentType: "COMM",
            countryCode: "82",
            from: creds.smsFrom,
            content: data.message,
            messages: chunk.map((r) => ({ to: r.phone })),
          };
          const res = await fetch(`https://sens.apigw.ntruss.com${path}`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            const txt = await res.text();
            throw new Error(`SENS ${res.status}: ${txt.slice(0, 200)}`);
          }
        }
        results.push({ branch, count: list.length, ok: true });
      } catch (err: any) {
        if (err.message?.includes("지원되지 않는")) unknownBranches.push(branch);
        results.push({ branch, count: list.length, ok: false, error: err.message });
      }
    }

    return {
      total: data.recipients.length,
      groups: results,
      unknownBranches,
    };
  });

export const sendClassBrandTalk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        classId: z.string().uuid(),
        recipients: z.array(RecipientSchema).min(1).max(1000),
        message: z.string().min(1).max(2000),
        fallbackToSms: z.boolean().default(true),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdminOrInstructorOnClass(context, data.classId);
    const groups = new Map<string, typeof data.recipients>();
    for (const r of data.recipients) {
      const b = normalizeBranch(r.branch);
      if (!b) continue;
      const phone = normalizePhone(r.phone);
      if (!phone) continue;
      const arr = groups.get(b) ?? [];
      arr.push({ ...r, phone });
      groups.set(b, arr);
    }
    if (groups.size === 0) throw new Error("발송 가능한 수신자가 없습니다.");

    const results: Array<{ branch: string; count: number; ok: boolean; error?: string }> = [];
    for (const [branch, list] of groups) {
      try {
        const creds = getBranchCreds(branch);
        if (!creds.btServiceId || !creds.btChannelId) {
          throw new Error(`${branch} 브랜드톡 서비스 ID 또는 채널 ID가 설정되지 않았습니다.`);
        }
        // 템플릿 코드 없이 자유 문구 발송
        const path = `/alimtalk/v2/services/${creds.btServiceId}/messages`;
        const headers = await sensHeaders("POST", path, creds.accessKey, creds.secretKey);
        const failoverSms = data.fallbackToSms && creds.smsFrom
          ? { type: byteLen(data.message) > 80 ? ("LMS" as const) : ("SMS" as const), from: creds.smsFrom, content: data.message }
          : null;
        const body: any = {
          plusFriendId: creds.btChannelId,
          messages: list.map((r) => ({
            countryCode: "82",
            to: r.phone,
            content: data.message,
            ...(failoverSms ? { failoverConfig: failoverSms } : {}),
          })),
        };
        const res = await fetch(`https://sens.apigw.ntruss.com${path}`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`SENS ${res.status}: ${txt.slice(0, 200)}`);
        }
        results.push({ branch, count: list.length, ok: true });
      } catch (err: any) {
        results.push({ branch, count: list.length, ok: false, error: err.message });
      }
    }
    return { total: data.recipients.length, groups: results };
  });
