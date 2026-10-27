import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { messagingProgressByStudent } from "./messaging-progress";
import { fetchAllIn } from "./fetch-all";

describe("문자 진도 공통 대상 집계", () => {
  it("직접 선택해도 DB 대상이 없는 잠긴 학생은 제외", () => {
    const counts = messagingProgressByStudent([{ user_id: "open", video_id: "selected" }], [], []);
    assert.equal(counts.has("locked"), false);
    assert.equal(counts.get("open")?.incomplete_count, 1);
  });
  it("배정 전 업로드라도 반환된 9월 1~3주차와 개별 열기·시청 기록 영상을 모두 포함", () => {
    const targets = ["2026-09-1", "2026-09-2", "2026-09-3", "unlock", "watched"].map((video_id) => ({ user_id: "student", video_id }));
    const counts = messagingProgressByStudent(targets, [{ user_id: "student", video_id: "watched", is_completed: true }], []);
    assert.deepEqual(counts.get("student"), { eligible_total: 5, completed_count: 1, incomplete_count: 4 });
  });
  it("숨김은 시청 기록·개별 열기보다 우선", () => {
    const row = { user_id: "student", video_id: "hidden" };
    assert.equal(messagingProgressByStudent([row], [{ ...row, is_completed: true }], [row]).has("student"), false);
  });
  it("1000행 페이지와 200개 ID 분할을 모두 끝까지 읽음", async () => {
    const ids = Array.from({ length: 201 }, (_, i) => String(i));
    const calls: number[] = [];
    const rows = await fetchAllIn<{ user_id: number; video_id: string }>(ids, async (part, from, to) => {
      calls.push(part.length);
      const all = part.flatMap((video_id) => Array.from({ length: 269 }, (_, user_id) => ({ video_id, user_id })));
      return { data: all.slice(from, to + 1), error: null };
    });
    assert.equal(rows.length, 201 * 269);
    assert.equal(new Set(rows.map((r) => `${r.user_id}:${r.video_id}`)).size, 54069);
    assert.ok(calls.includes(200));
    assert.ok(calls.includes(1));
  });
  it("페이지 조회 실패는 부분 진도로 처리하지 않고 오류 반환", async () => {
    await assert.rejects(fetchAllIn(["video"], async () => ({ data: null, error: { message: "조회 실패" } })), /조회 실패/);
  });
});