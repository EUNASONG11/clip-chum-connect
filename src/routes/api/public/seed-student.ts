import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/seed-student")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as {
          email?: string;
          password?: string;
        };
        const email = body.email ?? "test@gmail.com";
        const password = body.password ?? "12345678";

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        // 이미 존재하는지 확인
        const { data: list, error: listErr } =
          await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
        if (listErr) {
          return new Response(JSON.stringify({ error: listErr.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
        const existing = list.users.find(
          (u) => (u.email ?? "").toLowerCase() === email.toLowerCase(),
        );

        let userId: string;
        if (existing) {
          userId = existing.id;
        } else {
          const { data: created, error: createErr } =
            await supabaseAdmin.auth.admin.createUser({
              email,
              password,
              email_confirm: true,
            });
          if (createErr || !created.user) {
            return new Response(
              JSON.stringify({ error: createErr?.message ?? "생성 실패" }),
              {
                status: 500,
                headers: { "Content-Type": "application/json" },
              },
            );
          }
          userId = created.user.id;
        }

        // 학생 역할 부여 (중복 무시)
        const { error: roleErr } = await supabaseAdmin
          .from("user_roles")
          .insert({ user_id: userId, role: "student" });
        if (roleErr && !roleErr.message.includes("duplicate")) {
          return new Response(JSON.stringify({ error: roleErr.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response(
          JSON.stringify({ ok: true, userId, email, created: !existing }),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
