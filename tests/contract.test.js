import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateEvent } from "../src/validator.js";

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), "utf8"));
}

test("样例符合领域约定", async () => {
  const sample = await readJson("../data/sample.json");
  assert.deepEqual(validateEvent(sample), []);
});

test("信贷全链路样例的每条事件都符合信封约定", async () => {
  const journey = await readJson("../data/lifecycle/full-credit-journey.json");
  assert.equal(journey.length, 30);
  for (const event of journey) {
    assert.deepEqual(validateEvent(event), [], `${event.event_id} ${event.event_type}`);
  }
});

test("纯支付链路样例的每条事件都符合信封约定", async () => {
  const journey = await readJson("../data/lifecycle/pure-payment-journey.json");
  assert.equal(journey.length, 5);
  for (const event of journey) {
    assert.deepEqual(validateEvent(event), [], `${event.event_id} ${event.event_type}`);
  }
});

test("信封缺字段或使用未登记取值会被拒绝", async () => {
  const sample = await readJson("../data/sample.json");

  const missing = { ...sample };
  delete missing.session_id;
  assert.ok(validateEvent(missing).some((message) => message.includes("session_id")));

  assert.ok(validateEvent({ ...sample, event_type: "HISTORY_DELETED" }).some((m) => m.includes("未登记的事件类型")));
  assert.ok(validateEvent({ ...sample, aggregate_type: "loan_contract" }).some((m) => m.includes("不允许挂在聚合")));
  assert.ok(validateEvent({ ...sample, data_classification: "credit_bureau" }).some((m) => m.includes("不允许使用数据分类")));
  assert.ok(validateEvent({ ...sample, visible_to: ["merchant"] }).some((m) => m.includes("user")));
});

test("收单、开额度、放款等事件必须携带幂等键", async () => {
  const journey = await readJson("../data/lifecycle/pure-payment-journey.json");
  const captured = journey.find((event) => event.event_type === "PAYMENT_CAPTURED");
  const withoutKey = { ...captured };
  delete withoutKey.idempotency_key;
  assert.ok(validateEvent(withoutKey).some((message) => message.includes("idempotency_key")));
});
