import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateEvent, validateFlow } from "../src/validator.js";

const flow = JSON.parse(await readFile(new URL("../data/checkout-flow-sample.json", import.meta.url), "utf8"));

function base(overrides = {}) {
  return {
    event_id: "t-1",
    event_type: "PAYMENT_METHOD_SELECTED",
    aggregate_type: "checkout_session",
    aggregate_id: "checkout-t",
    checkout_id: "t",
    occurred_at: "2026-10-01T10:00:00+08:00",
    version: 1,
    summary: "测试记录",
    actor_role: "user",
    visibility: ["user"],
    payload: { method: "credit", preselected: false },
    ...overrides,
  };
}

test("全生命周期样例每条记录均通过单事件校验", () => {
  for (const event of flow) {
    assert.deepEqual(validateEvent(event), [], `${event.event_id} 应通过校验`);
  }
});

test("全生命周期样例通过跨事件流程校验", () => {
  assert.deepEqual(validateFlow(flow), []);
});

test("信贷预选被拒绝", () => {
  const presented = base({ event_type: "PAYMENT_PRESENTED", payload: { options: [], credit_preselected: true } });
  assert.ok(validateEvent(presented).some((error) => error.includes("预选")));
  const selected = base({ payload: { method: "credit", preselected: true } });
  assert.ok(validateEvent(selected).some((error) => error.includes("预选")));
});

test("网络重试导致的重复放款被幂等规则拒绝", () => {
  const disbursed = base({
    event_type: "LOAN_DISBURSED",
    aggregate_type: "loan_contract",
    actor_role: "funder",
    idempotency_key: "idem-t-disburse",
    payload: { amount: 100, funder: "某资金方" },
  });
  const retry = { ...disbursed, event_id: "t-2" };
  assert.deepEqual(validateEvent(retry), []);
  assert.ok(validateFlow([disbursed, retry]).some((error) => error.includes("幂等冲突")));
});

test("征信更正必须指向存在的原记录", () => {
  const correction = base({
    event_type: "REPORT_CORRECTED",
    aggregate_type: "credit_correction",
    references: [],
    payload: { reason: "误报" },
  });
  assert.ok(validateEvent(correction).some((error) => error.includes("references")));
  const dangling = { ...correction, references: ["evt-not-exist"] };
  assert.ok(validateFlow([dangling]).some((error) => error.includes("历史不得删除")));
});

test("商户不得读取征信与负债类记录", () => {
  const record = base({
    event_type: "SUITABILITY_ASSESSED",
    aggregate_type: "suitability_assessment",
    visibility: ["user", "merchant"],
    payload: { result: "passed" },
  });
  assert.ok(validateEvent(record).some((error) => error.includes("商户不得读取")));
});

test("客服仅可接触合同与争议记录", () => {
  const record = base({
    event_type: "CREDIT_APPLIED",
    aggregate_type: "credit_application",
    idempotency_key: "idem-t-apply",
    visibility: ["user", "customer_service"],
  });
  assert.ok(validateEvent(record).some((error) => error.includes("客服")));
});

test("退款必须按实际资金路径冲销", () => {
  const refund = base({
    event_type: "REFUND_SETTLED",
    aggregate_type: "refund",
    idempotency_key: "idem-t-refund",
    references: ["evt-loan"],
    payload: { amount: 100 },
  });
  assert.ok(validateEvent(refund).some((error) => error.includes("fund_path")));
  const withoutLoan = { ...refund, payload: { amount: 100, fund_path: "merchant→funder" } };
  assert.ok(validateFlow([withoutLoan]).some((error) => error.includes("LOAN_DISBURSED")));
});

test("条款更新后须按新版本重新确认", () => {
  const updated = base({
    event_id: "t-terms",
    event_type: "TERMS_UPDATED",
    aggregate_type: "terms_document",
    actor_role: "system",
    occurred_at: "2026-10-01T10:05:00+08:00",
    terms_version: "contract-2.3",
  });
  const staleConsent = base({
    event_id: "t-consent",
    event_type: "CONSENT_CAPTURED",
    occurred_at: "2026-10-01T10:06:00+08:00",
    terms_version: "contract-2.2",
  });
  assert.ok(validateFlow([updated, staleConsent]).some((error) => error.includes("重新确认")));
  const freshConsent = { ...staleConsent, terms_version: "contract-2.3" };
  assert.deepEqual(validateFlow([updated, freshConsent]), []);
});

test("综合融资成本须优惠前后同一口径并标明谁收费", () => {
  const disclosed = base({
    event_type: "COST_DISCLOSED",
    aggregate_type: "cost_disclosure",
    payload: { apr_before_discount: 0.18, calculation_method: "IRR 口径 v1", fees: [{ name: "利息", charged_by: "funder" }] },
  });
  assert.ok(validateEvent(disclosed).some((error) => error.includes("apr_after_discount")));
});

test("放款与逾期通知须标明谁放款、谁催收", () => {
  const disbursed = base({
    event_type: "LOAN_DISBURSED",
    aggregate_type: "loan_contract",
    idempotency_key: "idem-t-disburse",
    payload: { amount: 100 },
  });
  assert.ok(validateEvent(disbursed).some((error) => error.includes("谁放款")));
  const overdue = base({ event_type: "OVERDUE_NOTIFIED", aggregate_type: "overdue_notice", payload: { amount_due: 100 } });
  assert.ok(validateEvent(overdue).some((error) => error.includes("谁催收")));
});
