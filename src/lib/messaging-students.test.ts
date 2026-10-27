import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { messagingStudent } from "./messaging-students";
import { fetchAll } from "./fetch-all";

describe("문자 학생별 집계 반환", () => {
  const row = { user_id: "student", eligible_total: 8, completed_count: 3, name: "학생", phone: "010-1234-5678", parent_phone: "010-9876-5432", branch: "상동" };
  it("대상 수와 완료 수를 그대로 유지하고 미완료 수만 차감", () => {
    const result = messagingStudent(row);
    assert.equal(result.eligible_total, 8);
    assert.equal(result.completed_count, 3);
    assert.equal(result.incomplete_count, 5);
    assert.equal(result.status, "incomplete");
    assert.equal(messagingStudent({ ...row, completed_count: 8 }).status, "completed");
  });
  it("기존 학생 전화번호 우선 정규화와 학부모 대체 유지", () => {
    assert.equal(messagingStudent(row).phone, "01012345678");
    assert.equal(messagingStudent(row).phone_source, "self");
    const fallback = messagingStudent({ ...row, phone: "123" });
    assert.equal(fallback.phone, "01098765432");
    assert.equal(fallback.phone_source, "parent");
  });
  it("학생별 269행은 한 번만 조회", async () => {
    let calls = 0;
    const rows = await fetchAll(async () => { calls++; return { data: Array.from({ length: 269 }, (_, user_id) => ({ user_id })), error: null }; });
    assert.equal(calls, 1);
    assert.equal(rows.length, 269);
  });
  it("1000명 초과 결과는 학생 정렬 순서로 모두 조회", async () => {
    const all = Array.from({ length: 1269 }, (_, user_id) => ({ user_id }));
    const ranges: number[][] = [];
    const rows = await fetchAll(async (from, to) => { ranges.push([from, to]); return { data: all.slice(from, to + 1), error: null }; });
    assert.deepEqual(ranges, [[0, 999], [1000, 1999]]);
    assert.deepEqual(rows, all);
  });
  it("집계 조회 오류는 부분 결과로 처리하지 않음", async () => {
    await assert.rejects(fetchAll(async () => ({ data: null, error: { message: "집계 실패" } })), /집계 실패/);
  });
});