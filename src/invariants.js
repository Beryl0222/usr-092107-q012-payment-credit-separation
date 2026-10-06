/**
 * 事件流级合规不变量。每个函数接收按追加顺序排列的事件数组，
 * 返回违规列表 [{ rule, event_id, message }]，空数组表示通过。
 * validateStream 会依次执行全部规则，是合规检查的入口。
 */
import {
  AGGREGATE_PREREQUISITES,
  ALLOWED_READERS,
  COMMON_STAGES,
  CONFIRMING_EVENTS,
  CREDIT_STAGES,
  IDEMPOTENCY_REQUIRED,
  PRESENTATION_REFERENCE_REQUIRED,
} from "./policy.js";
import { validateEvent } from "./validator.js";

function violation(rule, event, message) {
  return { rule, event_id: event ? event.event_id : null, message };
}

function groupBy(events, keyOf) {
  const groups = new Map();
  for (const event of events) {
    const key = keyOf(event);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  }
  return groups;
}

/** 比较 "2026.09.1" 形式的版本号，返回负数、0 或正数。 */
export function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

/** 信贷不得预选：展示留档中任何信贷选项都不得是默认或已选状态。 */
export function checkNoPreselectedCredit(events) {
  const violations = [];
  for (const event of events) {
    if (event.event_type !== "PRESENTATION_ARCHIVED") continue;
    const options = event.payload?.shown_options;
    if (!Array.isArray(options) || options.length === 0) continue;

    const byId = new Map();
    for (const option of options) {
      if (!isNonEmptyString(option?.method_id) || !isNonEmptyString(option?.method_type) || !isNonEmptyString(option?.label)) {
        violations.push(violation("no-preselected-credit", event, "支付选项必须带有 method_id、method_type 和让用户一眼区分的 label"));
        continue;
      }
      byId.set(option.method_id, option);
    }
    for (const field of ["default_method_id", "preselected_method_id"]) {
      const chosen = event.payload?.[field];
      if (chosen == null) continue;
      const option = byId.get(chosen);
      if (option && option.method_type === "credit") {
        violations.push(violation("no-preselected-credit", event, `信贷选项不得作为${field === "default_method_id" ? "默认" : "预选"}方式：${chosen}`));
      }
    }
  }
  return violations;
}

/** 优惠前后成本同一口径：同一报价的各次披露必须使用相同的计算方法与币种，且优惠后不得更贵。 */
export function checkConsistentCostBasis(events) {
  const violations = [];
  const byOffer = groupBy(
    events.filter((event) => event.event_type === "CREDIT_DISCLOSED"),
    (event) => event.aggregate_id,
  );
  for (const [offerId, disclosures] of byOffer) {
    let basis = null;
    for (const event of disclosures) {
      const { calculation_method: method, currency, before_discount: before, after_discount: after } = event.payload ?? {};
      if (!isNonEmptyString(method) || !isNonEmptyString(currency)) {
        violations.push(violation("cost-basis", event, "成本披露必须标明计算方法（calculation_method）与币种（currency）"));
        continue;
      }
      if (!before || !after || typeof before.apr !== "number" || typeof after.apr !== "number"
        || typeof before.total_cost !== "number" || typeof after.total_cost !== "number") {
        violations.push(violation("cost-basis", event, "成本披露必须同时给出优惠前与优惠后的年化利率和总成本"));
        continue;
      }
      if (basis && (basis.method !== method || basis.currency !== currency)) {
        violations.push(violation("cost-basis", event, `报价 ${offerId} 的披露口径被中途更改：${basis.method}/${basis.currency} → ${method}/${currency}`));
      }
      basis = basis ?? { method, currency };
      if (after.total_cost > before.total_cost || after.apr > before.apr) {
        violations.push(violation("cost-basis", event, "优惠后的成本不得高于优惠前"));
      }
    }
  }
  return violations;
}

/** 页面或合同更新后，未完成的流程必须基于新版本重新展示、重新确认。 */
export function checkReconfirmation(events) {
  const violations = [];
  const bySession = groupBy(events, (event) => event.session_id);
  for (const [sessionId, sessionEvents] of bySession) {
    let requiredPage = null;
    let requiredContract = null;
    let pagePending = false;
    let contractPending = false;
    for (const event of sessionEvents) {
      if (event.event_type === "RECONFIRMATION_REQUIRED") {
        const { new_page_version: newPage, new_contract_version: newContract } = event.payload ?? {};
        if (isNonEmptyString(newPage)) {
          if (requiredPage === null || compareVersions(newPage, requiredPage) > 0) requiredPage = newPage;
          pagePending = true;
        }
        if (isNonEmptyString(newContract)) {
          if (requiredContract === null || compareVersions(newContract, requiredContract) > 0) requiredContract = newContract;
          contractPending = true;
        }
        if (!isNonEmptyString(newPage) && !isNonEmptyString(newContract)) {
          violations.push(violation("reconfirmation", event, "RECONFIRMATION_REQUIRED 必须给出新的页面版本或合同版本"));
        }
        continue;
      }
      if (event.event_type === "PRESENTATION_ARCHIVED") {
        const version = event.payload?.page_version;
        if (pagePending && isNonEmptyString(version) && requiredPage !== null && compareVersions(version, requiredPage) >= 0) {
          pagePending = false;
        }
        continue;
      }
      if (event.event_type === "CONTRACT_PRESENTED") {
        const version = event.payload?.contract_version;
        if (contractPending && isNonEmptyString(version) && requiredContract !== null && compareVersions(version, requiredContract) >= 0) {
          contractPending = false;
        }
        continue;
      }
      if (!CONFIRMING_EVENTS.includes(event.event_type)) continue;
      if (pagePending) {
        violations.push(violation("reconfirmation", event, `会话 ${sessionId} 页面已更新，未按新版本重新展示就记录了用户确认`));
      }
      if (event.event_type === "CONTRACT_SIGNED" && contractPending) {
        violations.push(violation("reconfirmation", event, `会话 ${sessionId} 合同已更新，未重新展示新版本合同就记录了签署`));
      }
      const pageVersion = event.payload?.page_version;
      if (requiredPage !== null && isNonEmptyString(pageVersion) && compareVersions(pageVersion, requiredPage) < 0) {
        violations.push(violation("reconfirmation", event, `确认所用页面版本 ${pageVersion} 低于最新要求 ${requiredPage}`));
      }
      const contractVersion = event.payload?.contract_version;
      if (event.event_type === "CONTRACT_SIGNED" && requiredContract !== null
        && isNonEmptyString(contractVersion) && compareVersions(contractVersion, requiredContract) < 0) {
        violations.push(violation("reconfirmation", event, `签署所用合同版本 ${contractVersion} 低于最新要求 ${requiredContract}`));
      }
    }
  }
  return violations;
}

/** 幂等：开额度、放款、收单、退款等事件的幂等键不得重复。 */
export function checkIdempotency(events) {
  const violations = [];
  const seen = new Map();
  for (const event of events) {
    if (!IDEMPOTENCY_REQUIRED.includes(event.event_type)) continue;
    const key = event.idempotency_key;
    if (!isNonEmptyString(key)) continue; // 缺失由信封校验报告
    const fingerprint = `${event.event_type}:${key}`;
    if (seen.has(fingerprint)) {
      violations.push(violation("idempotency", event, `幂等键重复：${fingerprint}（首次出现于 ${seen.get(fingerprint)}），重试不得重复开额度或放款`));
    } else {
      seen.set(fingerprint, event.event_id);
    }
  }
  return violations;
}

/** 可见性：调用方只能读到履行职责所需的数据分类；商户不得读征信与负债，客服只接触合同与争议。 */
export function checkVisibility(events) {
  const violations = [];
  for (const event of events) {
    const allowed = ALLOWED_READERS[event.data_classification];
    if (!allowed || !Array.isArray(event.visible_to)) continue;
    for (const role of event.visible_to) {
      if (!allowed.includes(role)) {
        violations.push(violation("visibility", event, `角色 ${role} 不得读取 ${event.data_classification} 类数据`));
      }
    }
    if (event.event_type === "PAYMENT_METHOD_SELECTED"
      && event.payload?.method_type === "credit"
      && event.data_classification !== "credit_detail") {
      violations.push(violation("visibility", event, "用户选择信贷后，该选择记录必须按 credit_detail 分类，避免商户读到负债信息"));
    }
  }
  return violations;
}

/** 退款按实际资金路径冲销：反向流水必须镜像原资金路径，且累计退款不得超过原金额。 */
export function checkRefundFundPath(events) {
  const violations = [];
  const byId = new Map(events.map((event) => [event.event_id, event]));
  const refundedTotal = new Map();
  for (const event of events) {
    if (event.event_type !== "REFUND_COMPLETED") continue;
    const reversals = event.payload?.reversals;
    if (!Array.isArray(reversals) || reversals.length === 0) {
      violations.push(violation("refund-fund-path", event, "退款完成必须记录按原资金路径冲销的 reversals"));
      continue;
    }
    for (const reversal of reversals) {
      const original = byId.get(reversal?.original_event_id);
      if (!original || !["PAYMENT_CAPTURED", "LOAN_DISBURSED"].includes(original.event_type)) {
        violations.push(violation("refund-fund-path", event, `冲销引用的原始资金事件不存在或类型不符：${reversal?.original_event_id}`));
        continue;
      }
      const originalLegs = Array.isArray(original.payload?.fund_path) ? original.payload.fund_path : [];
      const legs = Array.isArray(reversal.legs) ? reversal.legs : [];
      if (legs.length === 0) {
        violations.push(violation("refund-fund-path", event, "冲销记录必须包含反向资金流水 legs"));
        continue;
      }
      for (const leg of legs) {
        const mirror = originalLegs.find((orig) => orig.from === leg.to && orig.to === leg.from);
        if (!mirror) {
          violations.push(violation("refund-fund-path", event, `冲销流水 ${leg.from}→${leg.to} 与原资金路径不符`));
        } else if (typeof leg.amount !== "number" || leg.amount <= 0 || leg.amount > mirror.amount) {
          violations.push(violation("refund-fund-path", event, `冲销金额 ${leg.amount} 超出原流水金额 ${mirror.amount}`));
        }
      }
      const reversalSum = legs.reduce((sum, leg) => sum + (typeof leg.amount === "number" ? leg.amount : 0), 0);
      const key = original.event_id;
      const total = (refundedTotal.get(key) ?? 0) + reversalSum;
      refundedTotal.set(key, total);
      if (typeof original.payload?.amount === "number" && total > original.payload.amount) {
        violations.push(violation("refund-fund-path", event, `对 ${key} 的累计退款 ${total} 超出原交易金额 ${original.payload.amount}`));
      }
    }
  }
  return violations;
}

/** 征信更正以新记录修复历史：更正必须指向流中仍存在的原始记录，不得删除历史。 */
export function checkCorrectionKeepsHistory(events) {
  const violations = [];
  const byId = new Map(events.map((event) => [event.event_id, event]));
  for (const event of events) {
    if (event.event_type !== "REPORT_CORRECTED") continue;
    const targetId = event.payload?.corrects_event_id;
    if (!isNonEmptyString(targetId) || !byId.has(targetId)) {
      violations.push(violation("correction-keeps-history", event, `更正记录必须引用仍保留在事件流中的原始记录：${targetId ?? "缺失"}`));
    }
    if (!isNonEmptyString(event.payload?.reason) || !Array.isArray(event.payload?.corrected_fields) || event.payload.corrected_fields.length === 0) {
      violations.push(violation("correction-keeps-history", event, "更正记录必须说明原因并列出更正的字段"));
    }
  }
  return violations;
}

/** 用户每次所见内容留档：关键事件必须引用同一会话中已归档的展示记录。 */
export function checkPresentationArchived(events) {
  const violations = [];
  const bySession = groupBy(events, (event) => event.session_id);
  for (const [sessionId, sessionEvents] of bySession) {
    const archived = new Set();
    for (const event of sessionEvents) {
      if (event.event_type === "PRESENTATION_ARCHIVED") {
        const { page_id: pageId, page_version: pageVersion, content_hash: contentHash } = event.payload ?? {};
        if (!isNonEmptyString(pageId) || !isNonEmptyString(pageVersion) || !isNonEmptyString(contentHash)) {
          violations.push(violation("presentation-archived", event, "展示留档必须包含 page_id、page_version 与 content_hash"));
        }
        archived.add(event.aggregate_id);
        continue;
      }
      if (!PRESENTATION_REFERENCE_REQUIRED.includes(event.event_type)) continue;
      const presentationId = event.payload?.presentation_id;
      if (!isNonEmptyString(presentationId) || !archived.has(presentationId)) {
        violations.push(violation("presentation-archived", event, `会话 ${sessionId} 中找不到 ${event.event_type} 引用的展示留档：${presentationId ?? "缺失"}`));
      }
    }
  }
  return violations;
}

/** 协议不得折叠打包：合同展示的每份协议都必须有单独的同意记录，签署时必须逐项确认。 */
export function checkAgreementsConsented(events) {
  const violations = [];
  const byContract = groupBy(
    events.filter((event) => event.aggregate_type === "loan_contract"),
    (event) => event.aggregate_id,
  );
  for (const [contractId, contractEvents] of byContract) {
    let presented = null;
    for (const event of contractEvents) {
      if (event.event_type === "CONTRACT_PRESENTED") {
        const agreements = event.payload?.agreements;
        if (!Array.isArray(agreements) || agreements.length === 0
          || agreements.some((a) => !isNonEmptyString(a?.agreement_id) || !isNonEmptyString(a?.title) || !isNonEmptyString(a?.version))) {
          violations.push(violation("agreement-consent", event, "合同展示必须列出每份协议的 agreement_id、title 与 version"));
          presented = null;
        } else {
          presented = { event, agreements };
        }
        continue;
      }
      if (event.event_type !== "CONTRACT_SIGNED") continue;
      if (!presented) continue; // 未展示即签署由前置条件规则报告
      const acknowledged = new Set(event.payload?.acknowledged_agreements ?? []);
      const consents = events.filter((candidate) => candidate.session_id === event.session_id
        && candidate.event_type === "CONSENT_CAPTURED"
        && candidate.payload?.consent_type === "agreement"
        && candidate.payload?.granted === true);
      for (const agreement of presented.agreements) {
        if (!acknowledged.has(agreement.agreement_id)) {
          violations.push(violation("agreement-consent", event, `签署时未逐项确认协议：${agreement.agreement_id}`));
        }
        const consented = consents.some((candidate) => candidate.payload?.agreement_id === agreement.agreement_id);
        if (!consented) {
          violations.push(violation("agreement-consent", event, `合同 ${contractId} 的协议 ${agreement.agreement_id} 缺少独立的同意记录`));
        }
      }
    }
  }
  return violations;
}

/** 主体一致性：谁放款、谁收费、谁催收必须在披露、合同、放款与催收通知之间保持一致。 */
export function checkPartyConsistency(events) {
  const violations = [];
  const PARTY_FIELDS = ["lender", "fee_collector", "collector_party"];
  const PARTY_LABELS = { lender: "放款方", fee_collector: "收费方", collector_party: "催收方" };

  const latestDisclosureBySession = new Map();
  for (const event of events) {
    if (event.event_type !== "CREDIT_DISCLOSED") continue;
    const parties = event.payload?.parties ?? {};
    for (const field of PARTY_FIELDS) {
      if (!isNonEmptyString(parties[field])) {
        violations.push(violation("party-consistency", event, `成本披露必须明确${PARTY_LABELS[field]}（parties.${field}）`));
      }
    }
    latestDisclosureBySession.set(event.session_id, event);
  }

  const presentedByContract = new Map();
  for (const event of events) {
    if (event.event_type === "CONTRACT_PRESENTED") presentedByContract.set(event.aggregate_id, event);
  }

  for (const event of events) {
    if (event.event_type === "CONTRACT_PRESENTED") {
      const disclosure = latestDisclosureBySession.get(event.session_id);
      if (!disclosure) continue;
      for (const field of PARTY_FIELDS) {
        if (isNonEmptyString(disclosure.payload?.parties?.[field])
          && event.payload?.parties?.[field] !== disclosure.payload.parties[field]) {
          violations.push(violation("party-consistency", event, `合同中的${PARTY_LABELS[field]}与成本披露不一致`));
        }
      }
    }
    if (event.event_type === "LOAN_DISBURSED") {
      const presented = presentedByContract.get(event.aggregate_id);
      if (presented && isNonEmptyString(presented.payload?.parties?.lender)
        && event.payload?.lender !== presented.payload.parties.lender) {
        violations.push(violation("party-consistency", event, "放款方与合同约定不一致"));
      }
    }
    if (event.event_type === "OVERDUE_NOTICE_SENT") {
      const presented = presentedByContract.get(event.payload?.contract_id);
      if (!presented) {
        violations.push(violation("party-consistency", event, `逾期通知引用的合同没有展示记录：${event.payload?.contract_id}`));
      } else if (event.payload?.collector_party !== presented.payload?.parties?.collector_party) {
        violations.push(violation("party-consistency", event, "实际催收方与合同披露的催收方不一致"));
      }
    }
  }
  return violations;
}

/** 会话阶段顺序：商品确认→支付选择→（信贷：披露→评估→授信→额度→合同→签署→放款）依次完成。 */
export function checkSessionStageOrder(events) {
  const violations = [];
  const bySession = groupBy(events, (event) => event.session_id);
  for (const [sessionId, sessionEvents] of bySession) {
    const firstIndex = new Map();
    sessionEvents.forEach((event, index) => {
      if (!firstIndex.has(event.event_type)) firstIndex.set(event.event_type, index);
    });
    const checkOrder = (stages, label) => {
      const present = stages.filter((stage) => firstIndex.has(stage));
      if (present.length === 0) return;
      const highest = stages.indexOf(present[present.length - 1]);
      for (const stage of stages.slice(0, highest + 1)) {
        if (!firstIndex.has(stage)) {
          violations.push(violation("session-stage-order", sessionEvents[firstIndex.get(present[present.length - 1])], `会话 ${sessionId} 缺少${label}阶段：${stage}`));
        }
      }
      for (let i = 1; i < present.length; i += 1) {
        if (firstIndex.get(present[i]) <= firstIndex.get(present[i - 1])) {
          violations.push(violation("session-stage-order", sessionEvents[firstIndex.get(present[i])], `会话 ${sessionId} 阶段顺序颠倒：${present[i - 1]} 应先于 ${present[i]}`));
        }
      }
    };
    checkOrder(COMMON_STAGES, "公共");
    checkOrder(CREDIT_STAGES, "信贷");
    if (firstIndex.has("CREDIT_DISCLOSED") && firstIndex.has("PAYMENT_METHOD_SELECTED")
      && firstIndex.get("CREDIT_DISCLOSED") <= firstIndex.get("PAYMENT_METHOD_SELECTED")) {
      violations.push(violation("session-stage-order", sessionEvents[firstIndex.get("CREDIT_DISCLOSED")], `会话 ${sessionId} 必须先选择支付方式再进入信贷披露`));
    }
  }
  return violations;
}

/** 适当性评估通过后才允许提交授信申请。 */
export function checkSuitabilityGate(events) {
  const violations = [];
  const bySession = groupBy(events, (event) => event.session_id);
  for (const [sessionId, sessionEvents] of bySession) {
    let passed = false;
    for (const event of sessionEvents) {
      if (event.event_type === "SUITABILITY_EVALUATED" && event.payload?.result === "passed") passed = true;
      if (event.event_type === "CREDIT_APPLICATION_SUBMITTED" && !passed) {
        violations.push(violation("suitability-gate", event, `会话 ${sessionId} 在适当性评估通过前提交了授信申请`));
      }
    }
  }
  return violations;
}

/** 聚合级前置条件：同一聚合上关键事件必须按序出现。 */
export function checkAggregatePrerequisites(events) {
  const violations = [];
  const byAggregate = groupBy(events, (event) => `${event.aggregate_type}/${event.aggregate_id}`);
  for (const [, aggregateEvents] of byAggregate) {
    const seen = new Set();
    for (const event of aggregateEvents) {
      for (const required of AGGREGATE_PREREQUISITES[event.event_type] ?? []) {
        if (!seen.has(required)) {
          violations.push(violation("aggregate-prerequisite", event, `${event.event_type} 之前必须先完成 ${required}（聚合 ${event.aggregate_id}）`));
        }
      }
      seen.add(event.event_type);
    }
  }
  return violations;
}

/** 放款金额不得超过已开通的授信额度。 */
export function checkDisbursementWithinLimit(events) {
  const violations = [];
  const bySession = groupBy(events, (event) => event.session_id);
  for (const [, sessionEvents] of bySession) {
    const lines = new Map();
    for (const event of sessionEvents) {
      if (event.event_type === "CREDIT_LINE_OPENED") {
        lines.set(event.aggregate_id, event);
        continue;
      }
      if (event.event_type !== "LOAN_DISBURSED") continue;
      const line = lines.get(event.payload?.credit_line_id);
      if (!line) {
        violations.push(violation("disbursement-limit", event, `放款引用的授信额度不存在：${event.payload?.credit_line_id}`));
        continue;
      }
      const limit = line.payload?.approved_limit;
      const amount = event.payload?.amount;
      if (typeof limit === "number" && typeof amount === "number" && amount > limit) {
        violations.push(violation("disbursement-limit", event, `放款金额 ${amount} 超出授信额度 ${limit}`));
      }
    }
  }
  return violations;
}

/** 还款必须对应还款计划中的期次。 */
export function checkRepaymentMatchesSchedule(events) {
  const violations = [];
  const byContract = groupBy(
    events.filter((event) => event.aggregate_type === "loan_contract"),
    (event) => event.aggregate_id,
  );
  for (const [, contractEvents] of byContract) {
    const scheduled = new Set();
    for (const event of contractEvents) {
      if (event.event_type === "REPAYMENT_SCHEDULE_ISSUED") {
        for (const installment of event.payload?.installments ?? []) {
          if (installment?.installment_no != null) scheduled.add(installment.installment_no);
        }
        continue;
      }
      if (event.event_type === "REPAYMENT_RECEIVED" && !scheduled.has(event.payload?.installment_no)) {
        violations.push(violation("repayment-schedule", event, `还款期次 ${event.payload?.installment_no} 不在已下发的还款计划中`));
      }
    }
  }
  return violations;
}

const ALL_CHECKS = [
  checkNoPreselectedCredit,
  checkConsistentCostBasis,
  checkReconfirmation,
  checkIdempotency,
  checkVisibility,
  checkRefundFundPath,
  checkCorrectionKeepsHistory,
  checkPresentationArchived,
  checkAgreementsConsented,
  checkPartyConsistency,
  checkSessionStageOrder,
  checkSuitabilityGate,
  checkAggregatePrerequisites,
  checkDisbursementWithinLimit,
  checkRepaymentMatchesSchedule,
];

/** 对完整事件流执行信封校验与全部合规不变量，返回违规列表。 */
export function validateStream(events) {
  const violations = [];
  for (const event of events) {
    for (const message of validateEvent(event)) {
      violations.push(violation("envelope", event, message));
    }
  }
  for (const check of ALL_CHECKS) {
    violations.push(...check(events));
  }
  return violations;
}
