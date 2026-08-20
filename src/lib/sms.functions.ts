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
  mode: "read" | "write" = "write",
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: adminData } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (adminData) return;
  const { data: cls } = await supabaseAdmin
    .from("classes")
    .select("created_by, category_id")
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
  if (assigned) return;
  // 조회 모드: 카테고리에 지정된 기수 권한이 있으면 읽기 허용
  if (mode === "read" && cls.category_id) {
    const [{ data: cat }, { data: me }] = await Promise.all([
      supabaseAdmin
        .from("class_categories")
        .select("cohort")
        .eq("id", cls.category_id)
        .is("deleted_at", null)
        .maybeSingle(),
      supabaseAdmin
        .from("instructors")
        .select("cohort, cohorts")
        .eq("auth_user_id", context.userId)
        .maybeSingle(),
    ]);
    const catCohort = (cat as any)?.cohort as string | null | undefined;
    const myCohorts: string[] = [
      ...(((me as any)?.cohorts ?? []) as string[]),
      ...((me as any)?.cohort ? [(me as any).cohort as string] : []),
    ];
    if (catCohort && myCohorts.includes(catCohort)) return;
  }
  throw new Error("이 수강반에 문자 전송 권한이 없습니다.");
}

// ---------- 수강반 학생 조회 (문자 전송용) ----------

export const listClassStudentsForMessaging = createServerFn({ method: "POST" })
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
        const completedCount = eligible.reduce(
          (n, v) => (completedSet.has(`${uid}::${v.id}`) ? n + 1 : n),
          0,
        );
        const incompleteCount = eligible.length - completedCount;
        const studentPhone = normalizePhone(e.phone);
        const parentPhone = normalizePhone(e.parent_phone);
        const phone = studentPhone ?? parentPhone;
        const phoneSource: "self" | "parent" | null = studentPhone
          ? "self"
          : parentPhone
            ? "parent"
            : null;
        return {
          user_id: uid,
          name: (e.name as string) ?? "",
          phone: phone ?? "",
          phone_source: phoneSource,
          student_phone: studentPhone ?? "",
          parent_phone: parentPhone ?? "",
          branch: (e.branch as string) ?? "",
          status: incompleteCount === 0 ? ("completed" as const) : ("incomplete" as const),
          completed_count: completedCount,
          incomplete_count: incompleteCount,
          eligible_total: eligible.length,
        };
      })
      .filter(Boolean) as Array<{
      user_id: string;
      name: string;
      phone: string;
      phone_source: "self" | "parent" | null;
      student_phone: string;
      parent_phone: string;
      branch: string;
      status: "completed" | "incomplete";
      completed_count: number;
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

type LogRow = {
  batch_id: string;
  class_id: string;
  channel: "sms" | "brandtalk";
  message: string;
  user_id: string | null;
  recipient_name: string;
  phone: string;
  branch: string | null;
  success: boolean;
  error_message: string | null;
  sent_by: string;
};

async function writeSmsLogs(rows: LogRow[]) {
  if (rows.length === 0) return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("sms_logs").insert(rows as any);
  if (error) console.error("sms_logs insert failed:", error.message);
}

// ---------- 문자 전송 이력 조회 ----------

export const listClassSmsLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ classId: z.string().uuid(), limit: z.number().int().min(1).max(200).optional() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdminOrInstructorOnClass(context, data.classId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 최근 발송 묶음(batch) 목록만 먼저 확보 → 해당 묶음의 수신자만 조회
    const { data: batchRows, error: bErr } = await supabaseAdmin.rpc("class_sms_recent_batches", {
      _class_id: data.classId,
      _limit: data.limit ?? 30,
    });
    if (bErr) throw new Error(bErr.message);
    const batchIds = ((batchRows ?? []) as any[]).map((b: any) => b.batch_id);
    if (batchIds.length === 0) return [];

    const { data: rows, error } = await supabaseAdmin
      .from("sms_logs")
      .select(
        "id, batch_id, channel, message, user_id, recipient_name, phone, branch, success, error_message, sent_by, created_at",
      )
      .eq("class_id", data.classId)
      .in("batch_id", batchIds)
      .is("hidden_at", null)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const list = (rows ?? []) as any[];


    const senderIds = Array.from(new Set(list.map((r) => r.sent_by).filter(Boolean)));
    const senderMap = new Map<string, string>();
    if (senderIds.length > 0) {
      const { data: insts } = await supabaseAdmin
        .from("instructors")
        .select("auth_user_id, name")
        .in("auth_user_id", senderIds);
      ((insts ?? []) as any[]).forEach((i) => senderMap.set(i.auth_user_id, i.name));
    }

    const batches = new Map<
      string,
      {
        batch_id: string;
        channel: "sms" | "brandtalk";
        message: string;
        created_at: string;
        sender_name: string;
        total: number;
        success_count: number;
        fail_count: number;
        recipients: Array<{
          id: string;
          user_id: string | null;
          name: string;
          phone: string;
          branch: string | null;
          success: boolean;
          error_message: string | null;
        }>;
      }
    >();

    for (const r of list) {
      let b = batches.get(r.batch_id);
      if (!b) {
        b = {
          batch_id: r.batch_id,
          channel: r.channel,
          message: r.message,
          created_at: r.created_at,
          sender_name: senderMap.get(r.sent_by) ?? "",
          total: 0,
          success_count: 0,
          fail_count: 0,
          recipients: [],
        };
        batches.set(r.batch_id, b);
      }
      b.total += 1;
      if (r.success) b.success_count += 1;
      else b.fail_count += 1;
      b.recipients.push({
        id: r.id,
        user_id: r.user_id,
        name: r.recipient_name,
        phone: r.phone,
        branch: r.branch,
        success: r.success,
        error_message: r.error_message,
      });
    }

    return Array.from(batches.values()).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
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
    const batchId = crypto.randomUUID();
    const logRows: LogRow[] = [];

    for (const [branch, list] of groups) {
      let ok = true;
      let errMsg: string | null = null;
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
        ok = false;
        errMsg = err.message ?? "오류";
        if (err.message?.includes("지원되지 않는")) unknownBranches.push(branch);
        results.push({ branch, count: list.length, ok: false, error: err.message });
      }
      for (const r of list) {
        logRows.push({
          batch_id: batchId,
          class_id: data.classId,
          channel: "sms",
          message: data.message,
          user_id: r.user_id,
          recipient_name: r.name ?? "",
          phone: r.phone,
          branch,
          success: ok,
          error_message: errMsg,
          sent_by: context.userId,
        });
      }
    }

    await writeSmsLogs(logRows);

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
    const batchId = crypto.randomUUID();
    const logRows: LogRow[] = [];
    for (const [branch, list] of groups) {
      let ok = true;
      let errMsg: string | null = null;
      try {
        const creds = getBranchCreds(branch);
        if (!creds.btServiceId || !creds.btChannelId) {
          throw new Error(`${branch} 브랜드톡 서비스 ID 또는 채널 ID가 설정되지 않았습니다.`);
        }
        // 브랜드 메시지 v2 (Brand Message) — 템플릿 승인 불필요, 채널 친구 대상
        const path = `/brandmessage/v2/services/${creds.btServiceId}/messages`;
        const headers = await sensHeaders("POST", path, creds.accessKey, creds.secretKey);
        const failoverSms = data.fallbackToSms && creds.smsFrom
          ? { type: byteLen(data.message) > 80 ? ("LMS" as const) : ("SMS" as const), from: creds.smsFrom, content: data.message }
          : null;
        const body: any = {
          plusFriendId: creds.btChannelId,
          messageType: "TEXT",
          targeting: "I",
          contentType: "COMM",
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
        ok = false;
        errMsg = err.message ?? "오류";
        results.push({ branch, count: list.length, ok: false, error: err.message });
      }
      for (const r of list) {
        logRows.push({
          batch_id: batchId,
          class_id: data.classId,
          channel: "brandtalk",
          message: data.message,
          user_id: r.user_id,
          recipient_name: r.name ?? "",
          phone: r.phone,
          branch,
          success: ok,
          error_message: errMsg,
          sent_by: context.userId,
        });
      }
    }
    await writeSmsLogs(logRows);
    return { total: data.recipients.length, groups: results };

  });
