import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

/**
 * One-shot backfill: pull `education_center` from master.students and
 * write it to external_students.branch (matched by external_id).
 *
 * Guarded by MASTER_STUDENTS_WEBHOOK_SECRET (already-shared secret).
 * Call with: x-webhook-secret: <secret>
 */
export const Route = createFileRoute("/api/public/admin/backfill-branches")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.MASTER_STUDENTS_WEBHOOK_SECRET;
        const provided = request.headers.get("x-webhook-secret");
        if (!secret || provided !== secret) {
          return new Response("Unauthorized", { status: 401 });
        }

        const masterUrl = process.env.MASTER_SUPABASE_URL;
        const masterKey = process.env.MASTER_SUPABASE_SERVICE_ROLE_KEY;
        if (!masterUrl || !masterKey) {
          return new Response("Master credentials missing", { status: 500 });
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

        // Loop pages until master returns fewer than pageSize rows.
        // eslint-disable-next-line no-constant-condition
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

          // Group by branch value; empty-string / null skipped.
          const byBranch = new Map<string, string[]>();
          for (const row of data) {
            const branch = row.education_center;
            const id = row.id;
            if (!branch || typeof branch !== "string" || !id) continue;
            const trimmed = branch.trim();
            if (!trimmed) continue;
            if (!byBranch.has(trimmed)) byBranch.set(trimmed, []);
            byBranch.get(trimmed)!.push(id as string);
          }

          for (const [branch, ids] of byBranch) {
            // Update in chunks of 500 external_ids per query.
            for (let i = 0; i < ids.length; i += 500) {
              const chunk = ids.slice(i, i + 500);
              const { error: upErr, count } = await supabaseAdmin
                .from("external_students")
                .update({ branch, synced_at: new Date().toISOString() }, { count: "exact" })
                .in("external_id", chunk);
              if (upErr) {
                errors.push(`update ${branch}: ${upErr.message}`);
              } else if (count) {
                totalUpdated += count;
              }
            }
          }

          if (data.length < pageSize) break;
          from += pageSize;
        }

        return Response.json({
          ok: errors.length === 0,
          totalFetched,
          totalUpdated,
          errors,
        });
      },
    },
  },
});
