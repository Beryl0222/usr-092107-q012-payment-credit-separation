const required = ["event_id", "event_type", "aggregate_type", "aggregate_id", "occurred_at", "version", "summary"];

export const ROLES = [
  "user",
  "merchant",
  "payment_institution",
  "loan_facilitator",
  "funder",
  "collector",
  "credit_bureau",
  "customer_service",
  "regulator",
  "system",
];

/** 每个聚合允许承载的事件类型，即各流程状态的合法迁移载体。 */
export const AGGREGATE_EVENTS = {
  checkout_session: ["GOODS_CONFIRMED", "SCREEN_PRESENTED", "PAYMENT_PRESENTED", "PAYMENT_METHOD_SELECTED", "CONSENT_CAPTURED"],
  cost_disclosure: ["SCREEN_PRESENTED", "COST_DISCLOSED"],
  credit_offer: ["SCREEN_PRESENTED", "CREDIT_DISCLOSED"],
  suitability_assessment: ["SCREEN_PRESENTED", "SUITABILITY_ASSESSED"],
  credit_application: ["SCREEN_PRESENTED", "CREDIT_APPLIED", "CREDIT_DECIDED"],
  contract_signing: ["SCREEN_PRESENTED", "CONTRACT_SIGNED"],
  loan_contract: ["LOAN_DISBURSED", "REPAYMENT_RECORDED"],
  refund: ["REFUND_REQUESTED", "REFUND_SETTLED"],
  overdue_notice: ["OVERDUE_NOTIFIED"],
  dispute: ["DISPUTE_OPENED", "DISPUTE_RESOLVED"],
  credit_correction: ["REPORT_CORRECTED"],
  terms_document: ["TERMS_UPDATED"],
};

const KNOWN_EVENT_TYPES = new Set(Object.values(AGGREGATE_EVENTS).flat());

/** 有资金或授信副作用的事件：重试不得重复开额度、放款、退款或记账。 */
const IDEMPOTENCY_REQUIRED = new Set(["CREDIT_APPLIED", "CREDIT_DECIDED", "LOAN_DISBURSED", "REFUND_SETTLED", "REPAYMENT_RECORDED"]);

/** 含征信与负债信息的聚合：商户不得读取。 */
const CREDIT_DATA_AGGREGATES = new Set(["suitability_assessment", "credit_application", "credit_correction"]);

/** 客服职责范围：仅合同与争议。 */
const CUSTOMER_SERVICE_AGGREGATES = new Set(["contract_signing", "loan_contract", "dispute"]);

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

/** 校验单条领域记录。返回错误信息数组，空数组表示通过。 */
export function validateEvent(record) {
  const errors = required.filter((name) => !(name in record)).map((name) => `缺少字段：${name}`);
  if ("version" in record && (!Number.isInteger(record.version) || record.version < 1)) errors.push("version 必须是正整数");

  const type = record.event_type;
  const aggregate = record.aggregate_type;
  if (type !== undefined && !KNOWN_EVENT_TYPES.has(type)) errors.push(`未知事件类型：${type}`);
  if (aggregate !== undefined && !(aggregate in AGGREGATE_EVENTS)) errors.push(`未知聚合类型：${aggregate}`);
  if (KNOWN_EVENT_TYPES.has(type) && aggregate in AGGREGATE_EVENTS && !AGGREGATE_EVENTS[aggregate].includes(type)) {
    errors.push(`事件 ${type} 不属于聚合 ${aggregate}`);
  }

  if (!isNonEmptyString(record.actor_role)) errors.push("缺少字段：actor_role");
  else if (!ROLES.includes(record.actor_role)) errors.push(`未知角色：${record.actor_role}`);

  const visibility = record.visibility;
  if (!Array.isArray(visibility) || visibility.length === 0) {
    errors.push("缺少字段：visibility（须列出可读取本记录的角色）");
  } else {
    for (const role of visibility) {
      if (!ROLES.includes(role)) errors.push(`visibility 含未知角色：${role}`);
    }
    if (visibility.includes("merchant") && CREDIT_DATA_AGGREGATES.has(aggregate)) {
      errors.push("商户不得读取征信与负债类记录");
    }
    if (visibility.includes("customer_service") && !CUSTOMER_SERVICE_AGGREGATES.has(aggregate)) {
      errors.push("客服仅可接触自身职责内的合同与争议记录");
    }
  }

  if (IDEMPOTENCY_REQUIRED.has(type) && !isNonEmptyString(record.idempotency_key)) {
    errors.push(`${type} 必须携带 idempotency_key，网络重试不得重复开额度或放款`);
  }

  const payload = record.payload ?? {};
  switch (type) {
    case "PAYMENT_PRESENTED":
      if (payload.credit_preselected === true) errors.push("信贷不得预选：PAYMENT_PRESENTED.credit_preselected 必须为 false");
      break;
    case "PAYMENT_METHOD_SELECTED":
      if (payload.preselected === true) errors.push("信贷不得预选：支付方式必须由用户主动选择");
      if (!isNonEmptyString(payload.method)) errors.push("缺少 payload.method（cash 或 credit）");
      break;
    case "COST_DISCLOSED": {
      for (const key of ["apr_before_discount", "apr_after_discount"]) {
        if (typeof payload[key] !== "number" || payload[key] < 0) errors.push(`综合融资成本须包含 ${key}（非负数字）`);
      }
      if (!isNonEmptyString(payload.calculation_method)) errors.push("优惠前后成本须共用同一 calculation_method 口径");
      if (!Array.isArray(payload.fees) || payload.fees.length === 0 || payload.fees.some((fee) => !isNonEmptyString(fee?.charged_by))) {
        errors.push("每项费用须标明 charged_by（谁收费）");
      }
      break;
    }
    case "LOAN_DISBURSED":
      if (!isNonEmptyString(payload.funder)) errors.push("放款记录须标明 funder（谁放款）");
      break;
    case "OVERDUE_NOTIFIED":
      if (!isNonEmptyString(payload.collector)) errors.push("逾期通知须标明 collector（谁催收）");
      break;
    case "REPORT_CORRECTED":
      if (!Array.isArray(record.references) || record.references.length === 0) {
        errors.push("征信更正必须以 references 指向原记录，历史不得删除");
      }
      break;
    case "REFUND_SETTLED":
      if (!Array.isArray(record.references) || record.references.length === 0) errors.push("退款必须以 references 指向原放款记录");
      if (!isNonEmptyString(payload.fund_path)) errors.push("退款须记录 fund_path，按实际资金路径冲销");
      break;
    case "CONTRACT_SIGNED":
      if (!Array.isArray(record.references) || record.references.length === 0) {
        errors.push("签署记录必须以 references 关联所展示的页面与确认记录，供监管重放");
      }
      break;
    case "SCREEN_PRESENTED":
      if (!isNonEmptyString(payload.content_uri) || !isNonEmptyString(payload.content_hash)) {
        errors.push("所见留档须包含 content_uri 与 content_hash，供事后重放");
      }
      break;
  }
  return errors;
}

/** 校验一组记录之间的跨事件规则。返回错误信息数组，空数组表示通过。 */
export function validateFlow(events) {
  const errors = [];
  const ids = new Set(events.map((event) => event.event_id));

  // 网络重试不得重复开额度或放款：同一事件类型的幂等键只能出现一次。
  const seenKeys = new Map();
  for (const event of events) {
    if (!IDEMPOTENCY_REQUIRED.has(event.event_type) || !isNonEmptyString(event.idempotency_key)) continue;
    const key = `${event.event_type}:${event.idempotency_key}`;
    if (seenKeys.has(key)) {
      errors.push(`幂等冲突：${event.event_type} 的 idempotency_key ${event.idempotency_key} 重复（${seenKeys.get(key)} 与 ${event.event_id}）`);
    } else {
      seenKeys.set(key, event.event_id);
    }
  }

  for (const event of events) {
    if (event.event_type === "REPORT_CORRECTED") {
      for (const ref of event.references ?? []) {
        if (!ids.has(ref)) errors.push(`更正记录 ${event.event_id} 指向的原记录 ${ref} 不存在，历史不得删除`);
      }
    }
    if (event.event_type === "REFUND_SETTLED") {
      const targets = (event.references ?? []).map((ref) => events.find((candidate) => candidate.event_id === ref));
      if (!targets.some((target) => target && target.event_type === "LOAN_DISBURSED")) {
        errors.push(`退款 ${event.event_id} 必须冲销一笔实际放款（references 须含 LOAN_DISBURSED）`);
      }
    }
    if (event.event_type === "CONTRACT_SIGNED") {
      for (const ref of event.references ?? []) {
        if (!ids.has(ref)) errors.push(`签署 ${event.event_id} 关联的展示记录 ${ref} 不存在，无法重放`);
      }
    }
  }

  // 页面或合同更新后，未完成流程须按最新版本重新确认。
  const updates = events
    .filter((event) => event.event_type === "TERMS_UPDATED" && event.checkout_id)
    .sort((a, b) => (a.occurred_at < b.occurred_at ? -1 : 1));
  for (const event of events) {
    if (!["CONSENT_CAPTURED", "CONTRACT_SIGNED"].includes(event.event_type) || !event.checkout_id) continue;
    const prior = updates.filter((update) => update.checkout_id === event.checkout_id && update.occurred_at <= event.occurred_at);
    if (prior.length === 0) continue;
    const latest = prior[prior.length - 1].terms_version;
    if (event.terms_version !== latest) {
      errors.push(`${event.event_type} ${event.event_id} 使用的条款版本 ${event.terms_version} 已过期，须按最新版本 ${latest} 重新确认`);
    }
  }
  return errors;
}
