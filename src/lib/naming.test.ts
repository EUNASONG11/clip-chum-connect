import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRegularVideoTitle, parseRegularVideoTitle, isValidRegularVideoTitle } from "./naming";
import { assertRegularVideoTitle } from "./naming.server";

describe("어휘 제목 규칙", () => {
  it("어휘 12강은 기존 강 번호 방식으로 유지", () => {
    assert.equal(isValidRegularVideoTitle("어휘 12강"), true);
    const parts = { kind: "vocab", mode: "lecture", lecture: 12 } as const;
    assert.deepEqual(parseRegularVideoTitle("어휘 12강"), parts);
    assert.equal(buildRegularVideoTitle(parts), "어휘 12강");
  });
  it("어휘 - 고전 한자어 정리를 직접 입력으로 생성·해석", () => {
    const parts = { kind: "vocab", mode: "custom", content: "고전 한자어 정리" } as const;
    assert.equal(isValidRegularVideoTitle("어휘 - 고전 한자어 정리"), true);
    assert.deepEqual(parseRegularVideoTitle("어휘 - 고전 한자어 정리"), parts);
    assert.equal(buildRegularVideoTitle(parts), "어휘 - 고전 한자어 정리");
  });
  it("직접 입력 내용 앞뒤 공백 제거", () => {
    assert.equal(buildRegularVideoTitle({ kind: "vocab", mode: "custom", content: "  고전 한자어 정리  " }), "어휘 - 고전 한자어 정리");
    assert.deepEqual(parseRegularVideoTitle("어휘 -   고전 한자어 정리  "), { kind: "vocab", mode: "custom", content: "고전 한자어 정리" });
  });
  it("어휘 - 와 공백뿐인 내용은 불가", () => {
    assert.equal(isValidRegularVideoTitle("어휘 - "), false);
    assert.equal(isValidRegularVideoTitle("어휘 -    "), false);
    assert.equal(buildRegularVideoTitle({ kind: "vocab", mode: "custom", content: "  " }), null);
  });
  it("어휘12강은 불가", () => {
    assert.equal(isValidRegularVideoTitle("어휘12강"), false);
  });
  it("직접 입력 전체 제목 200자까지 허용하고 201자는 거부", () => {
    const content = "가".repeat(195);
    assert.equal(buildRegularVideoTitle({ kind: "vocab", mode: "custom", content }), `어휘 - ${content}`);
    assert.equal(isValidRegularVideoTitle(`어휘 - ${content}`), true);
    assert.equal(buildRegularVideoTitle({ kind: "vocab", mode: "custom", content: content + "가" }), null);
    assert.equal(isValidRegularVideoTitle(`어휘 - ${content}가`), false);
  });
  it("입력칸 최대 내용 150자는 유효한 제목", () => {
    assert.equal(buildRegularVideoTitle({ kind: "vocab", mode: "custom", content: "가".repeat(150) })?.length, 155);
  });
  it("어휘 외 과목과 어휘 주차 제목의 기존 규칙 유지", () => {
    const parts = { kind: "general", month: 9, week: 1, subject: "문학", content: "고전 시가" } as const;
    assert.equal(buildRegularVideoTitle(parts), "[9월 1주차] 문학 - 고전 시가");
    assert.deepEqual(parseRegularVideoTitle("[9월 1주차] 문학 - 고전 시가"), parts);
    assert.equal(isValidRegularVideoTitle("[9월 1주차] 어휘 - 고전 한자어 정리"), false);
  });
  it("정규 수강반 서버 검사는 두 어휘 형식 모두 허용하고 빈 내용은 거부", async () => {
    const db = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { class_type: "정규" } }) }) }) }) };
    await assert.doesNotReject(assertRegularVideoTitle(db, "class", "어휘 12강"));
    await assert.doesNotReject(assertRegularVideoTitle(db, "class", "어휘 - 고전 한자어 정리"));
    await assert.rejects(assertRegularVideoTitle(db, "class", "어휘 - "));
    await assert.rejects(assertRegularVideoTitle(db, "class", "어휘12강"));
  });
});