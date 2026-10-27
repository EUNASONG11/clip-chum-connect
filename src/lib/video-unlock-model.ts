export type AccessState = "locked" | "unlocked" | "not_locked" | "hidden";
export type UnlockStudent = { user_id: string; name: string; school: string; grade: string; branch: string; phone: string; parent_phone: string; unlock_count: number };
export type UnlockVideo = { id: string; title: string; thumbnail_url: string | null; week_label: string | null; created_at: string; folder_id: string | null; sort_order: number };
export type UnlockFolder = { id: string; name: string; parent_folder_id: string | null; sort_order: number };
export type UnlockSnapshot = { students: UnlockStudent[]; videos: UnlockVideo[]; folders: UnlockFolder[]; states: { video_id: string; user_id: string; state: AccessState }[]; excluded_count: number };
export const accessLabels: Record<AccessState, string> = { locked: "잠김", unlocked: "개별 열기됨", not_locked: "잠금 대상 아님", hidden: "숨김 처리됨" };

export function accessState(baseLocked: boolean, progress: boolean, unlock: boolean, hidden: boolean): AccessState {
  if (hidden) return "hidden";
  if (!baseLocked || progress) return "not_locked";
  return unlock ? "unlocked" : "locked";
}

export function matchesUnlockStudent(student: UnlockStudent, query: string) {
  const fields = [student.name, student.school, student.grade, student.branch, student.phone, student.parent_phone];
  return query.split(/\s+/).filter(Boolean).every((token) => !token) || query.split(/\s+/).filter(Boolean).some((token) => fields.some((field) => field.replace(/\s|-/g, "").toLowerCase().includes(token.replace(/\s|-/g, "").toLowerCase())));
}

// 학생 화면: 폴더 자체 영상 다음에 하위 폴더, 마지막은 폴더 미지정 영상.
export function orderedUnlockVideos(videos: UnlockVideo[], folders: UnlockFolder[]) {
  const output: { video: UnlockVideo; path: string }[] = [];
  const visited = new Set<string>();
  const sortedVideos = [...videos].sort((a, b) => a.sort_order - b.sort_order || b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
  const walk = (parent: string | null, path: string[]) => {
    const children = folders.filter((f) => f.parent_folder_id === parent).sort((a, b) => a.sort_order - b.sort_order);
    for (const folder of children) {
      if (visited.has(folder.id)) continue;
      visited.add(folder.id);
      const next = [...path, folder.name];
      sortedVideos.filter((v) => v.folder_id === folder.id).forEach((video) => output.push({ video, path: next.join(" / ") }));
      walk(folder.id, next);
    }
  };
  walk(null, []);
  sortedVideos.filter((v) => !v.folder_id || !visited.has(v.folder_id)).forEach((video) => output.push({ video, path: "폴더 미지정" }));
  return output;
}