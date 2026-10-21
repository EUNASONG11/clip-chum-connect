import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { cohortFromTeacherEmail, resolveStudentCohort } from "@/lib/cohort";

/**
 * Admin-only: 마스터 students(+teachers)에서 기수를 계산해 external_students.cohort 를 일괄 채운다.
 * 규칙은 src/lib/cohort.ts 참고. 여러 번 실행해도 결과가 같다(idempotent).
 * 기수를 계산할 수 없는 학생은 기존 값을 건드리지 않는다.
 */
export const backfillCohortsFromMaster = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("관리자만 실행할 수 있습니다.");

    const masterUrl = process.env.MASTER_SUPABASE_URL;
    const masterKey = process.env.MASTER_SUPABASE_SERVICE_ROLE_KEY;
    if (!masterUrl || !masterKey) {
      throw new Error("마스터 프로젝트 접속 정보가 설정되어 있지 않습니다.");
    }

    const master = createClient(masterUrl, masterKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const pageSize = 1000;
    const errors: string[] = [];

    // 1) 강사 이메일 전부 (teacher_id → email)
    const teacherEmail = new Map<string, string>();
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await master
        .from("teachers")
        .select("id, email")
        .range(from, from + pageSize - 1);
      if (error) throw new Error(`teachers 조회 실패: ${error.message}`);
      for (const t of (data ?? []) as Array<{ id: string; email: string | null }>) {
        if (t.id && t.email) teacherEmail.set(String(t.id), t.email);
      }
      if (!data || data.length < pageSize) break;
    }

    // 2) 학생별 기수 계산
    let totalFetched = 0;
    let noTeacher = 0;
    const unknownEmails = new Set<string>();
    const byCohort = new Map<string, string[]>();
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await master
        .from("students")
        .select("id, teacher_id, cohort_override")
        .range(from, from + pageSize - 1);
      if (error) {
        errors.push(`students 조회 @${from}: ${error.message}`);
        break;
      }
      for (const s of (data ?? []) as Array<{ id: string; teacher_id: string | null; cohort_override: unknown }>) {
        totalFetched++;
        const email = s.teacher_id ? (teacherEmail.get(String(s.teacher_id)) ?? null) : null;
        if (!s.teacher_id) noTeacher++;
        else if (email && !cohortFromTeacherEmail(email)) unknownEmails.add(email);
        const cohort = resolveStudentCohort({ cohortOverride: s.cohort_override, teacherEmail: email });
        if (!cohort || !s.id) continue;
        if (!byCohort.has(cohort)) byCohort.set(cohort, []);
        byCohort.get(cohort)!.push(String(s.id));
      }
      if (!data || data.length < pageSize) break;
    }

    // 3) 기수별로 묶어서 업데이트
    let totalUpdated = 0;
    for (const [cohort, ids] of byCohort) {
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        const { error: upErr, count } = await supabaseAdmin
          .from("external_students")
          .update({ cohort }, { count: "exact" })
          .in("external_id", chunk);
        if (upErr) errors.push(`update ${cohort}: ${upErr.message}`);
        else if (count) totalUpdated += count;
      }
    }

    return {
      ok: errors.length === 0,
      totalFetched,
      totalUpdated,
      noTeacher,
      cohorts: Array.from(byCohort.keys()).sort((a, b) => parseInt(b, 10) - parseInt(a, 10)),
      unknownEmails: Array.from(unknownEmails).slice(0, 20),
      errors,
    };
  });
