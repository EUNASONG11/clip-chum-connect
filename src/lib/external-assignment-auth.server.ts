export async function assertExternalAssignmentStaff(context: {
  supabase: any;
  userId: string;
}) {
  const { data: isAdmin } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (isAdmin) return "admin" as const;

  const { data: isInstructor } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "instructor",
  });
  if (isInstructor) return "instructor" as const;

  throw new Error("관리자 또는 강사만 사용할 수 있습니다.");
}