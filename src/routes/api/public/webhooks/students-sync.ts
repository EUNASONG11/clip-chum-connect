import { createFileRoute } from "@tanstack/react-router";

/**
 * Inbound webhook from the master Supabase project's `students` table.
 * Configure on the master project as:
 *   Database → Webhooks → new hook on `public.students`
 *   Events: INSERT, UPDATE, DELETE
 *   URL: https://<this-project>/api/public/webhooks/students-sync
 *   HTTP header: `x-webhook-secret: <MASTER_STUDENTS_WEBHOOK_SECRET>`
 *
 * Supabase DB webhook payload shape:
 *   { type: 'INSERT'|'UPDATE'|'DELETE', table, schema, record, old_record }
 */

type SupabaseWebhookPayload = {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  schema: string;
  record: Record<string, unknown> | null;
  old_record: Record<string, unknown> | null;
};

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function normalizePhone(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  return s.replace(/[^0-9]/g, "") || null;
}

function derivePassword(phone: string | null): string {
  // Use last 8 digits of phone as initial password; fall back to random.
  if (phone && phone.length >= 8) return phone.slice(-8);
  return Math.random().toString(36).slice(-10) + "A1!";
}

function fakeEmail(externalId: string, phone: string | null, rawEmail: string | null): string {
  if (rawEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) return rawEmail;
  const local = phone ?? externalId.replace(/-/g, "").slice(0, 12);
  return `student-${local}@mirror.local`;
}

export const Route = createFileRoute("/api/public/webhooks/students-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.MASTER_STUDENTS_WEBHOOK_SECRET;
        if (!secret) {
          return new Response("Server not configured", { status: 500 });
        }

        const provided = request.headers.get("x-webhook-secret");
        if (!provided || provided !== secret) {
          return new Response("Unauthorized", { status: 401 });
        }

        let payload: SupabaseWebhookPayload;
        try {
          payload = (await request.json()) as SupabaseWebhookPayload;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // DELETE → mark our copy as deleted (soft delete).
        if (payload.type === "DELETE") {
          const externalId = str(payload.old_record?.id);
          if (!externalId) return new Response("ok");
          await supabaseAdmin
            .from("external_students")
            .update({ is_deleted: true, synced_at: new Date().toISOString() })
            .eq("external_id", externalId);
          return new Response("ok");
        }

        const rec = payload.record;
        if (!rec) return new Response("Missing record", { status: 400 });

        const externalId = str(rec.id);
        const name = str(rec.name);
        if (!externalId || !name) {
          return new Response("Missing id or name", { status: 400 });
        }

        const phone = normalizePhone(rec.phone);
        const parentPhone = normalizePhone(rec.parent_phone);
        const emailRaw = str(rec.email);
        const school = str(rec.school);
        const grade = str(rec.grade);
        const classTime = str(rec.class_time);
        const enrollmentStatus = str(rec.enrollment_status);
        const branch = str(rec.education_center) ?? str(rec.branch);
        // 기수: 외부 DB의 cohort_override(예: "15기", "15")에서 추출
        const cohortRaw = str(rec.cohort_override);
        const cohortMatch = cohortRaw ? /(\d+)/.exec(cohortRaw) : null;
        const cohort = cohortMatch ? `${cohortMatch[1]}기` : null;
        const isDeletedFromMaster = rec.is_deleted === true;
        // 학생 본인 전화번호가 없으면 학부모 전화번호를 로그인용 기본값으로 사용.
        const loginPhone = phone ?? parentPhone;

        // Check if we already have this student mirrored.
        const { data: existing } = await supabaseAdmin
          .from("external_students")
          .select("id, auth_user_id, phone, parent_phone")
          .eq("external_id", externalId)
          .maybeSingle();

        let authUserId: string | null = existing?.auth_user_id ?? null;

        // Auto-provision auth account on first sight (skip if master marks deleted).
        if (!authUserId && !isDeletedFromMaster) {
          const email = fakeEmail(externalId, loginPhone, emailRaw);
          const password = derivePassword(loginPhone);

          const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { name, phone, parent_phone: parentPhone, external_id: externalId, source: "master-mirror" },
          });

          if (createErr) {
            // If the email already exists, try to look it up so we can still link.
            const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
            const found = list?.users.find((u) => u.email === email);
            if (found) authUserId = found.id;
            else console.error("createUser failed", createErr);
          } else if (created?.user) {
            authUserId = created.user.id;
          }

          // 승인 대기 제도 폐지: 신규 계정은 즉시 학생 권한 부여
          if (authUserId) {
            const { error: roleErr } = await supabaseAdmin
              .from("user_roles")
              .upsert(
                { user_id: authUserId, role: "student" },
                { onConflict: "user_id,role", ignoreDuplicates: true },
              );
            if (roleErr) console.error("grant student role failed", roleErr);
          }
        } else if (authUserId && loginPhone) {
          // 번호가 변경된 경우: 로그인 계정(이메일 + 비밀번호)을 새 번호로 즉시 동기화
          const prevLoginPhone = existing?.phone ?? existing?.parent_phone ?? null;
          if (prevLoginPhone !== loginPhone) {
            const newEmail = fakeEmail(externalId, loginPhone, emailRaw);
            const newPassword = derivePassword(loginPhone);

            const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(authUserId, {
              email: newEmail,
              email_confirm: true,
              password: newPassword,
              user_metadata: {
                name,
                phone,
                parent_phone: parentPhone,
                external_id: externalId,
                source: "master-mirror",
              },
            });

            if (updErr) {
              // 이메일 중복 등으로 실패하면 비밀번호만이라도 새 번호로 맞춘다.
              console.error("sync login email failed", updErr);
              const { error: pwErr } = await supabaseAdmin.auth.admin.updateUserById(authUserId, {
                password: newPassword,
              });
              if (pwErr) console.error("sync login password failed", pwErr);
            }
          }
        }



        // Upsert mirror row.
        const { error: upsertErr } = await supabaseAdmin
          .from("external_students")
          .upsert(
            {
              external_id: externalId,
              name,
              phone,
              parent_phone: parentPhone,
              school,
              grade,
              class_time: classTime,
              enrollment_status: enrollmentStatus,
              branch,
              ...(cohort ? { cohort } : {}),
              is_deleted: isDeletedFromMaster,
              auth_user_id: authUserId,
              synced_at: new Date().toISOString(),
            },
            { onConflict: "external_id" },
          );

        if (upsertErr) {
          console.error("upsert external_students failed", upsertErr);
          return new Response("DB error", { status: 500 });
        }

        return new Response("ok");
      },
    },
  },
});
