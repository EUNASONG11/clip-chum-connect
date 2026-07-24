import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/upload")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/videos" });
  },
});
