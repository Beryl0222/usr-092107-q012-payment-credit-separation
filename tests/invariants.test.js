import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateStream } from "../src/invariants.js";

async function loadJourney(name) {
  return JSON.parse(await readFile(new URL(`../data/lifecycle/${name}`, import.meta.url), "utf8"));
}

function byId(events, eventId) {
  const event = events.find((candidate) => candidate.event_id === eventId);
  assert.ok(event, `样例中应存在事件 ${eventId}`);
  return event;
}

function rules(violations) {
  return new Set(violations.map((violation) => violation.rule));
}

test("信贷全链路样例通过全部合规不变量", async () => {
  const journey = await loadJourney("full-credit-journey.json");
  assert.deepEqual(validateStream(journey), []);
});

test("纯支付链路样例通过全部合规不变量", async () => {
  const journey = await loadJourney("pure-payment-journey.json");
  assert.deepEqual(validateStream(journey), []);
});

test("信贷不得预选：默认或预选指向信贷选项即违规", async () => {
  const journey = await loadJourney("full-credit-journey.json");
  byId(journey, "evt-0005").payload.preselected_method_id = "m-credit-3";
  assert.ok(rules(validateStream(journey)).has("no-preselected-credit"));
});

test("优惠前后必须同一口径：中途变更计算方法即违规", async () => {
  const journey = await loadJourney("full-credit-journey.json");
  const disclosed = byId(journey, "evt-0009");
  const changed = structuredClone(disclosed);
  changed.event_id = "evt-0009b";
  changed.occurred_at = "2026-07-01T10:01:12+08:00";
  changed.payload.calculation_method = "名义利率";
  journey.splice(journey.indexOf(disclosed) + 1, 0, changed);
  assert.ok(rules(validateStream(journey)).has("cost-basis"));
});

test("优惠后成本不得高于优惠前", async () => {
  const journey = await loadJourney("full-credit-journey.json");
  byId(journey, "evt-0009").payload.after_discount.total_cost = 400;
  assert.ok(rules(validateStream(journey)).has("cost-basis"));
});

test("页面更新后未按新版本重新展示就记录确认即违规", async () => {
  const journey = await loadJourney("full-credit-journey.json");
  // 删掉更新后的重新展示与重新呈现，让用户在旧版本页面上直接选择
  const removed = journey.filter((event) => !["evt-0005", "evt-0006"].includes(event.event_id));
  assert.ok(rules(validateStream(removed)).has("reconfirmation"));
});

test("确认所用页面版本低于最新要求即违规", async () => {
  const journey = await loadJourney("full-credit-journey.json");
  byId(journey, "evt-0007").payload.page_version = "2026.09.1";
  assert.ok(rules(validateStream(journey)).has("reconfirmation"));
});

test("合同更新后未重新展示新版本合同就签署即违规", async () => {
  const journey = await loadJourney("full-credit-journey.json");
  const signed = byId(journey, "evt-0021");
  const bump = {
    ...structuredClone(byId(journey, "evt-0004")),
    event_id: "evt-0004b",
    aggregate_type: "loan_contract",
    aggregate_id: "lc-1001",
    occurred_at: "2026-07-01T10:02:50+08:00",
    summary: "合同条款更新至 cv-4，未完成签署须重新确认",
    payload: { reason: "contract_updated", new_contract_version: "cv-4" },
  };
  journey.splice(journey.indexOf(signed), 0, bump);
  assert.ok(rules(validateStream(journey)).has("reconfirmation"));
});

test("幂等键重复（网络重试重复放款）即违规", async () => {
  const journey = await loadJourney("full-credit-journey.json");
  const disbursed = byId(journey, "evt-0022");
  const retry = { ...structuredClone(disbursed), event_id: "evt-0022-retry", occurred_at: "2026-07-01T10:03:07+08:00" };
  journey.splice(journey.indexOf(disbursed) + 1, 0, retry);
  assert.ok(rules(validateStream(journey)).has("idempotency"));
});

test("商户不得读取征信与负债类数据", async () => {
  const journey = await loadJourney("full-credit-journey.json");
  byId(journey, "evt-0009").visible_to.push("merchant");
  assert.ok(rules(validateStream(journey)).has("visibility"));
});

test("客服只能接触合同与争议，不得读取授信明细", async () => {
  const journey = await loadJourney("full-credit-journey.json");
  byId(journey, "evt-0015").visible_to.push("customer_service");
  assert.ok(rules(validateStream(journey)).has("visibility"));
});

test("选择信贷的记录不得按普通支付状态开放", async () => {
  const journey = await loadJourney("full-credit-journey.json");
  const selected = byId(journey, "evt-0007");
  selected.data_classification = "payment_status";
  selected.visible_to = ["user", "merchant", "payment_institution", "facilitation_platform", "funding_party", "regulator"];
  assert.ok(rules(validateStream(journey)).has("visibility"));
});

test("退款必须按原资金路径冲销", async () => {
  const journey = await loadJourney("full-credit-journey.json");
  byId(journey, "evt-0027").payload.reversals[0].legs[0].to = "someone-else";
  assert.ok(rules(validateStream(journey)).has("refund-fund-path"));
});

test("累计退款不得超过原交易金额", async () => {
  const journey = await loadJourney("full-credit-journey.json");
  const requested = structuredClone(byId(journey, "evt-0026"));
  requested.event_id = "evt-0026b";
  requested.aggregate_id = "rf-1002";
  requested.occurred_at = "2026-09-06T14:00:00+08:00";
  const completed = structuredClone(byId(journey, "evt-0027"));
  completed.event_id = "evt-0027b";
  completed.aggregate_id = "rf-1002";
  completed.occurred_at = "2026-09-06T14:00:20+08:00";
  completed.idempotency_key = "rf-1002-complete";
  completed.payload.reversals[0].legs[0].amount = 2500;
  journey.push(requested, completed);
  assert.ok(rules(validateStream(journey)).has("refund-fund-path"));
});

test("征信更正必须引用仍保留的原始记录", async () => {
  const journey = await loadJourney("full-credit-journey.json");
  byId(journey, "evt-0030").payload.corrects_event_id = "evt-9999";
  assert.ok(rules(validateStream(journey)).has("correction-keeps-history"));
});

test("关键动作必须引用已归档的展示留档", async () => {
  const journey = await loadJourney("full-credit-journey.json");
  const removed = journey.filter((event) => event.event_id !== "evt-0008");
  assert.ok(rules(validateStream(removed)).has("presentation-archived"));
});

test("协议不得折叠打包：缺少逐项同意即违规", async () => {
  const journey = await loadJourney("full-credit-journey.json");
  const removed = journey.filter((event) => event.event_id !== "evt-0020");
  assert.ok(rules(validateStream(removed)).has("agreement-consent"));
});

test("签署时未逐项确认全部协议即违规", async () => {
  const journey = await loadJourney("full-credit-journey.json");
  byId(journey, "evt-0021").payload.acknowledged_agreements = ["agr-loan", "agr-bureau"];
  assert.ok(rules(validateStream(journey)).has("agreement-consent"));
});

test("实际催收方必须与合同披露一致", async () => {
  const journey = await loadJourney("full-credit-journey.json");
  byId(journey, "evt-0025").payload.collector_party = "不明第三方催收公司";
  assert.ok(rules(validateStream(journey)).has("party-consistency"));
});

test("合同主体必须与成本披露一致", async () => {
  const journey = await loadJourney("full-credit-journey.json");
  byId(journey, "evt-0017").payload.parties.lender = "另一家资金方";
  assert.ok(rules(validateStream(journey)).has("party-consistency"));
});

test("缺少适当性评估不得进入授信申请", async () => {
  const journey = await loadJourney("full-credit-journey.json");
  const removed = journey.filter((event) => event.event_id !== "evt-0010");
  const found = rules(validateStream(removed));
  assert.ok(found.has("session-stage-order"));
  assert.ok(found.has("suitability-gate"));
});

test("未展示合同不得签署", async () => {
  const journey = await loadJourney("full-credit-journey.json");
  const removed = journey.filter((event) => event.event_id !== "evt-0017");
  assert.ok(rules(validateStream(removed)).has("aggregate-prerequisite"));
});

test("放款金额不得超过授信额度", async () => {
  const journey = await loadJourney("full-credit-journey.json");
  byId(journey, "evt-0022").payload.amount = 25000;
  assert.ok(rules(validateStream(journey)).has("disbursement-limit"));
});

test("还款必须对应还款计划中的期次", async () => {
  const journey = await loadJourney("full-credit-journey.json");
  byId(journey, "evt-0024").payload.installment_no = 9;
  assert.ok(rules(validateStream(journey)).has("repayment-schedule"));
});
