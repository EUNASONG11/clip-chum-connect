import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Admin-only: backfill external_students.branch from master.students.education_center.
 * Runs synchronously; safe to re-run (idempotent).
 */
export const backfillBranchesFromMaster = createServerFn({ method: "POST" })
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
    let from = 0;
    let totalFetched = 0;
    let totalUpdated = 0;
    const errors: string[] = [];

    while (true) {
      const { data, error } = await master
        .from("students")
        .select("id, education_center")
        .range(from, from + pageSize - 1);

      if (error) {
        errors.push(`master fetch @${from}: ${error.message}`);
        break;
      }
      if (!data || data.length === 0) break;
      totalFetched += data.length;

      const byBranch = new Map<string, string[]>();
      for (const row of data as Array<{ id: string; education_center: string | null }>) {
        const b = (row.education_center ?? "").toString().trim();
        if (!b || !row.id) continue;
        if (!byBranch.has(b)) byBranch.set(b, []);
        byBranch.get(b)!.push(row.id);
      }

      for (const [branch, ids] of byBranch) {
        for (let i = 0; i < ids.length; i += 500) {
          const chunk = ids.slice(i, i + 500);
          const { error: upErr, count } = await supabaseAdmin
            .from("external_students")
            .update(
              { branch, synced_at: new Date().toISOString() },
              { count: "exact" },
            )
            .in("external_id", chunk);
          if (upErr) errors.push(`update ${branch}: ${upErr.message}`);
          else if (count) totalUpdated += count;
        }
      }

      if (data.length < pageSize) break;
      from += pageSize;
    }

    return { ok: errors.length === 0, totalFetched, totalUpdated, errors };
  });
