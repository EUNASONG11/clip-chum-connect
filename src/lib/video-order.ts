// 학생 화면에 보이는 영상 순서(폴더 순서 → 폴더 안 영상 순서) 비교 헬퍼.
// "학습 현황 시작 영상" 잠금/집계 기준을 업로드 시각이 아니라 이 순서로 맞추기 위한 공용 로직.

export type OrderKey = {
  folderSort: number;
  sortOrder: number;
  createdAt: string;
  id: string;
};

export function orderKeyOf(
  v: { id: string; folder_id?: string | null; sort_order?: number | null; created_at?: string | null },
  folderSortMap: Map<string, number>,
): OrderKey {
  return {
    folderSort: v.folder_id ? (folderSortMap.get(v.folder_id) ?? 9999) : 9999,
    sortOrder: Number(v.sort_order ?? 0),
    createdAt: (v.created_at ?? "") as string,
    id: v.id,
  };
}

// a가 b보다 화면에서 앞에 오면 음수, 같으면 0, 뒤면 양수
export function compareOrderKeys(a: OrderKey, b: OrderKey): number {
  if (a.folderSort !== b.folderSort) return a.folderSort - b.folderSort;
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}
