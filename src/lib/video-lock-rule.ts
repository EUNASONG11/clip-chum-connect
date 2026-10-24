// 시작 주차/시작 시각 기준 잠금 판정 공용 규칙.
// DB 함수 student_video_locked와 같은 규칙을 앱 쪽(목록 잠금 표시, 학습 이력 필터)에서 쓰기 위한 헬퍼.
import { parseWeekLabel } from "@/lib/week";

/**
 * @param startWeek 진행 시작 주차("YYYY-MM-W"), 없으면 null
 * @param startAtMs 시작 주차가 있으면 그 주 월요일 00:00(KST), 없으면 student_video_start_at 값
 */
export function isVideoLockedByStart(
  v: { week_label?: string | null; created_at?: string | null },
  startWeek: string | null | undefined,
  startAtMs: number | null,
): boolean {
  const createdMs = v.created_at ? new Date(v.created_at).getTime() : 0;
  if (startWeek) {
    const sv = parseWeekLabel(startWeek);
    const vw = v.week_label ? parseWeekLabel(v.week_label) : null;
    if (sv && vw) {
      // 주차가 올바른 영상: 연·월·주차 숫자로 비교
      if (vw.year !== sv.year) return vw.year < sv.year;
      if (vw.month !== sv.month) return vw.month < sv.month;
      return vw.week < sv.week;
    }
    // 주차가 없는 영상(어휘 등): 시작 주 월요일 이전 업로드면 잠금
    return startAtMs !== null && createdMs < startAtMs;
  }
  // 시작 주차 미설정: 업로드 시각 기준
  return startAtMs !== null && createdMs < startAtMs;
}
