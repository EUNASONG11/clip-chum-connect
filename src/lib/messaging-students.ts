export type MessagingCount = {
  user_id: string;
  eligible_total: number;
  completed_count: number;
  name: string | null;
  phone: string | null;
  parent_phone: string | null;
  branch: string | null;
};

export function normalizePhone(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.replace(/[^0-9]/g, "");
  if (s.length < 9 || s.length > 11) return null;
  return s;
}

export function messagingStudent(count: MessagingCount) {
  const studentPhone = normalizePhone(count.phone);
  const parentPhone = normalizePhone(count.parent_phone);
  const incompleteCount = count.eligible_total - count.completed_count;
  const phoneSource: "self" | "parent" | null = studentPhone ? "self" : parentPhone ? "parent" : null;
  return {
    user_id: count.user_id,
    name: count.name ?? "",
    phone: studentPhone ?? parentPhone ?? "",
    phone_source: phoneSource,
    student_phone: studentPhone ?? "",
    parent_phone: parentPhone ?? "",
    branch: count.branch ?? "",
    status: incompleteCount === 0 ? ("completed" as const) : ("incomplete" as const),
    completed_count: count.completed_count,
    incomplete_count: incompleteCount,
    eligible_total: count.eligible_total,
  };
}