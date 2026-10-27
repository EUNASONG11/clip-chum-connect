import { describe, it as test } from "node:test";
import assert from "node:assert/strict";
import { accessState, orderedUnlockVideos } from "./video-unlock-model";
import { isVideoLockedByStart } from "./video-lock-rule";

describe("학생별 영상 개별 열기", () => {
  test("숨김은 개별 열기보다 우선", () => assert.equal(accessState(true, false, true, true), "hidden"));
  test("기준 잠금에 개별 열기가 있으면 열림", () => assert.equal(accessState(true, false, true, false), "unlocked"));
  test("시작 기준 변경 뒤에도 활성 개별 열기는 유지", () => assert.notEqual(accessState(true, false, true, false), "locked"));
  test("개별 열기 해제 시 기준 잠금 복원", () => assert.equal(accessState(true, false, false, false), "locked"));
  test("시청 기록은 기존 예외 유지", () => assert.equal(accessState(true, true, false, false), "not_locked"));
  test("기준상 열린 영상은 열기 대상 아님", () => assert.equal(accessState(false, false, false, false), "not_locked"));
  test("9월 1주차 이후 주차는 업로드 시각 무관", () => assert.equal(isVideoLockedByStart({ week_label: "2026-09-2", created_at: "2026-08-01T00:00:00Z" }, "2026-09-1", Date.parse("2026-08-30T15:00:00Z")), false));
  test("주차 없는 10월 4일 영상도 기준 잠금 예외로 개별 열기", () => {
    const locked = isVideoLockedByStart({ week_label: null, created_at: "2026-10-04T00:00:00Z" }, "2026-10-2", Date.parse("2026-10-04T15:00:00Z"));
    assert.equal(locked, true);
    assert.equal(accessState(locked, false, true, false), "unlocked");
  });
  test("상위 폴더 영상 다음 하위 폴더 영상", () => {
    const video = (id: string, folder_id: string, sort_order: number, created_at: string) => ({ id, folder_id, sort_order, created_at, title: id, week_label: null, thumbnail_url: null });
    const result = orderedUnlockVideos([video("child", "c", 0, "2026-10-04"), video("old", "p", 0, "2026-09-01"), video("new", "p", 0, "2026-10-04")], [{ id: "p", name: "예습", parent_folder_id: null, sort_order: 1 }, { id: "c", name: "문학", parent_folder_id: "p", sort_order: 0 }]);
    assert.deepEqual(result.map((r) => r.video.id), ["new", "old", "child"]);
    assert.equal(result[2]?.path, "예습 / 문학");
  });
});