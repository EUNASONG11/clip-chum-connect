export type MessagingTarget = { user_id: string; video_id: string };
export type MessagingProgress = MessagingTarget & { is_completed: boolean };

/** DB가 반환한 학생별 대상만 집계한다. 배정 시각이나 직접 선택 여부는 판단하지 않는다. */
export function messagingProgressByStudent(
  targets: MessagingTarget[],
  progress: MessagingProgress[],
  exclusions: MessagingTarget[],
) {
  const hidden = new Set(exclusions.map((row) => `${row.user_id}::${row.video_id}`));
  const completed = new Set(progress.filter((row) => row.is_completed).map((row) => `${row.user_id}::${row.video_id}`));
  const videosByStudent = new Map<string, Set<string>>();
  for (const row of targets) {
    if (hidden.has(`${row.user_id}::${row.video_id}`)) continue;
    const videos = videosByStudent.get(row.user_id) ?? new Set<string>();
    videos.add(row.video_id);
    videosByStudent.set(row.user_id, videos);
  }
  return new Map(Array.from(videosByStudent, ([userId, videos]) => {
    const completedCount = Array.from(videos).filter((id) => completed.has(`${userId}::${id}`)).length;
    return [userId, { eligible_total: videos.size, completed_count: completedCount, incomplete_count: videos.size - completedCount }];
  }));
}