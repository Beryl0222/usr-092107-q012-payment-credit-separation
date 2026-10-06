import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { replayChoice, replaySession } from "../src/replay.js";

async function loadJourney() {
  return JSON.parse(await readFile(new URL("../data/lifecycle/full-credit-journey.json", import.meta.url), "utf8"));
}

test("监管可按会话重放完整时间线", async () => {
  const journey = await loadJourney();
  const timeline = replaySession(journey, "sess-2026-1001");
  assert.equal(timeline.length, journey.length);
  for (let i = 1; i < timeline.length; i += 1) {
    assert.ok(Date.parse(timeline[i].occurred_at) >= Date.parse(timeline[i - 1].occurred_at), "时间线必须按发生时间排序");
  }
  assert.deepEqual(
    [...new Set(timeline.map((entry) => entry.event_type))].length > 10,
    true,
    "时间线应覆盖各环节的事件类型",
  );
});

test("重放某次签署可同时还原用户所见的合同内容", async () => {
  const journey = await loadJourney();
  const entry = replayChoice(journey, "evt-0021");
  assert.equal(entry.event_type, "CONTRACT_SIGNED");
  assert.equal(entry.payload.contract_version, "cv-3");
  assert.deepEqual(entry.payload.acknowledged_agreements, ["agr-loan", "agr-bureau", "agr-privacy"]);
  assert.equal(entry.presentation.content_hash, "sha256:contract-cv3");
  assert.equal(entry.presentation.page_version, "2026.09.2");
});

test("重放某次支付方式选择可核对当时展示的选项与默认状态", async () => {
  const journey = await loadJourney();
  const entry = replayChoice(journey, "evt-0007");
  assert.equal(entry.event_type, "PAYMENT_METHOD_SELECTED");
  assert.equal(entry.presentation.page_version, "2026.09.2");
  assert.equal(entry.presentation.default_method_id, null);
  const credit = entry.presentation.shown_options.find((option) => option.method_type === "credit");
  assert.ok(credit.label.includes("借款"), "信贷选项必须让用户一眼看出是借款");
});

test("重放不存在的会话或事件返回空结果", async () => {
  const journey = await loadJourney();
  assert.deepEqual(replaySession(journey, "sess-not-exist"), []);
  assert.equal(replayChoice(journey, "evt-not-exist"), null);
});
