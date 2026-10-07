import { isValidRegularVideoTitle } from "@/lib/naming";

/** 정규 수강반 영상이면 제목 형식을 검사한다. 형식이 틀리면 에러. */
export async function assertRegularVideoTitle(
  supabaseAdmin: any,
  classId: string | null | undefined,
  title: string | null | undefined,
): Promise<void> {
  if (!classId || title == null) return;
  const { data } = await supabaseAdmin.from("classes").select("class_type").eq("id", classId).maybeSingle();
  if (data?.class_type !== "정규") return;
  if (!isValidRegularVideoTitle(title)) {
    throw new Error("정규 수강반 영상 제목은 '[n월 n주차] 과목 - 내용' 또는 '어휘 n강' 형식이어야 합니다.");
  }
}
