import { describe, expect, test } from "bun:test";
import { accessState, orderedUnlockVideos } from "./video-unlock-model";

describe("학생별 영상 개별 열기", () => {
  test("숨김은 개별 열기보다 우선", () => expect(accessState(true, false, true, true)).toBe("hidden"));
  test("기준 잠금에 개별 열기가 있으면 열림", () => expect(accessState(true, false, true, false)).toBe("unlocked"));
  test("시작 기준 변경 뒤에도 활성 개별 열기는 유지", () => expect(accessState(true, false, true, false)).not.toBe("locked"));
  test("개별 열기 해제 시 기준 잠금 복원", () => expect(accessState(true, false, false, false)).toBe("locked"));
  test("시청 기록은 기존 예외 유지", () => expect(accessState(true, true, false, false)).toBe("not_locked"));
  test("기준상 열린 영상은 열기 대상 아님", () => expect(accessState(false, false, false, false)).toBe("not_locked"));
  test("상위 폴더 영상 다음 하위 폴더 영상", () => {
    const video = (id: string, folder_id: string, sort_order: number, created_at: string) => ({ id, folder_id, sort_order, created_at, title: id, week_label: null, thumbnail_url: null });
    const result = orderedUnlockVideos([video("child", "c", 0, "2026-10-04"), video("old", "p", 0, "2026-09-01"), video("new", "p", 0, "2026-10-04")], [{ id: "p", name: "예습", parent_folder_id: null, sort_order: 1 }, { id: "c", name: "문학", parent_folder_id: "p", sort_order: 0 }]);
    expect(result.map((r) => r.video.id)).toEqual(["new", "old", "child"]);
    expect(result[2]?.path).toBe("예습 / 문학");
  });
});