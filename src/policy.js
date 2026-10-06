/**
 * 支付信贷分离网关的事件目录与合规策略常量。
 *
 * 本文件是校验器（validator.js）与不变量（invariants.js）共用的唯一事实来源：
 * 事件类型、聚合类型、数据分类、角色可见性、幂等要求、展示留档引用、
 * 会话阶段顺序与聚合前置条件都在这里登记，修改规则时先改这里。
 */

/** 允许读取事件的角色。 */
export const ROLES = [
  "user", // 用户本人
  "merchant", // 商户
  "payment_institution", // 支付机构
  "facilitation_platform", // 助贷平台
  "funding_party", // 资金方
  "customer_service", // 客服
  "regulator", // 监管
  "credit_bureau_agency", // 征信机构
];

/** 数据分类。分类决定哪些角色可以读取。 */
export const DATA_CLASSIFICATIONS = [
  "order_info", // 商品与订单
  "payment_status", // 支付状态
  "presentation_record", // 用户所见内容留档
  "consent_record", // 同意与授权
  "credit_detail", // 成本披露、适当性、授信、额度
  "contract", // 合同展示与签署
  "fund_flow", // 收单、放款、退款等资金路径
  "debt_detail", // 还款计划、还款、逾期等负债明细
  "credit_bureau", // 征信报送更正
  "dispute", // 争议处理
];

/**
 * 每类数据允许读取的角色。visible_to 必须是对应集合的子集。
 * 商户只见订单与支付状态，不得读取征信与负债；客服只接触合同与争议。
 */
export const ALLOWED_READERS = {
  order_info: ["user", "merchant", "payment_institution", "facilitation_platform", "regulator"],
  payment_status: ["user", "merchant", "payment_institution", "facilitation_platform", "funding_party", "regulator"],
  presentation_record: ["user", "facilitation_platform", "regulator"],
  consent_record: ["user", "facilitation_platform", "funding_party", "regulator"],
  credit_detail: ["user", "facilitation_platform", "funding_party", "regulator"],
  contract: ["user", "facilitation_platform", "funding_party", "customer_service", "regulator"],
  fund_flow: ["user", "payment_institution", "facilitation_platform", "funding_party", "regulator"],
  debt_detail: ["user", "facilitation_platform", "funding_party", "regulator"],
  credit_bureau: ["user", "facilitation_platform", "funding_party", "credit_bureau_agency", "regulator"],
  dispute: ["user", "facilitation_platform", "funding_party", "customer_service", "regulator"],
};

/**
 * 事件目录：每个事件类型允许挂在哪些聚合上、使用哪些数据分类。
 * 多数事件只有一个分类；支付方式选择因是否选中信贷而不同。
 */
export const EVENT_SPEC = {
  ORDER_CONFIRMED: { aggregates: ["checkout_session"], classifications: ["order_info"] },
  PRESENTATION_ARCHIVED: { aggregates: ["presentation"], classifications: ["presentation_record"] },
  PAYMENT_PRESENTED: { aggregates: ["checkout_session"], classifications: ["payment_status"] },
  PAYMENT_METHOD_SELECTED: { aggregates: ["checkout_session"], classifications: ["payment_status", "credit_detail"] },
  PAYMENT_CAPTURED: { aggregates: ["checkout_session"], classifications: ["fund_flow"] },
  CREDIT_DISCLOSED: { aggregates: ["credit_offer"], classifications: ["credit_detail"] },
  SUITABILITY_EVALUATED: { aggregates: ["suitability_assessment"], classifications: ["credit_detail"] },
  CONSENT_CAPTURED: { aggregates: ["checkout_session"], classifications: ["consent_record"] },
  CREDIT_APPLICATION_SUBMITTED: { aggregates: ["credit_application"], classifications: ["credit_detail"] },
  CREDIT_APPLICATION_DECIDED: { aggregates: ["credit_application"], classifications: ["credit_detail"] },
  CREDIT_LINE_OPENED: { aggregates: ["credit_line"], classifications: ["credit_detail"] },
  CONTRACT_PRESENTED: { aggregates: ["loan_contract"], classifications: ["contract"] },
  CONTRACT_SIGNED: { aggregates: ["loan_contract"], classifications: ["contract"] },
  LOAN_DISBURSED: { aggregates: ["loan_contract"], classifications: ["fund_flow"] },
  REPAYMENT_SCHEDULE_ISSUED: { aggregates: ["loan_contract"], classifications: ["debt_detail"] },
  REPAYMENT_RECEIVED: { aggregates: ["loan_contract"], classifications: ["debt_detail"] },
  REFUND_REQUESTED: { aggregates: ["refund"], classifications: ["fund_flow"] },
  REFUND_COMPLETED: { aggregates: ["refund"], classifications: ["fund_flow"] },
  OVERDUE_NOTICE_SENT: { aggregates: ["overdue_notice"], classifications: ["debt_detail"] },
  DISPUTE_OPENED: { aggregates: ["dispute"], classifications: ["dispute"] },
  DISPUTE_RESOLVED: { aggregates: ["dispute"], classifications: ["dispute"] },
  REPORT_CORRECTED: { aggregates: ["credit_correction"], classifications: ["credit_bureau"] },
  RECONFIRMATION_REQUIRED: { aggregates: ["checkout_session", "loan_contract"], classifications: ["presentation_record"] },
};

export const EVENT_TYPES = Object.keys(EVENT_SPEC);

export const AGGREGATE_TYPES = [...new Set(Object.values(EVENT_SPEC).flatMap((spec) => spec.aggregates))];

/**
 * 重试不得造成重复副作用的事件：信封必须携带 idempotency_key，
 * 同一事件类型的同一幂等键在事件流中只允许出现一次。
 */
export const IDEMPOTENCY_REQUIRED = [
  "PAYMENT_CAPTURED",
  "CREDIT_APPLICATION_SUBMITTED",
  "CREDIT_LINE_OPENED",
  "LOAN_DISBURSED",
  "REFUND_COMPLETED",
];

/**
 * 用户每次所见内容必须留档：这些事件的 payload.presentation_id
 * 必须指向同一会话中已存在的 PRESENTATION_ARCHIVED 记录。
 */
export const PRESENTATION_REFERENCE_REQUIRED = [
  "PAYMENT_PRESENTED",
  "PAYMENT_METHOD_SELECTED",
  "CREDIT_DISCLOSED",
  "CONSENT_CAPTURED",
  "CONTRACT_PRESENTED",
  "CONTRACT_SIGNED",
];

/** 用户作出确认动作、因此受“版本更新须重新确认”约束的事件。 */
export const CONFIRMING_EVENTS = ["PAYMENT_METHOD_SELECTED", "CONSENT_CAPTURED", "CONTRACT_SIGNED"];

/**
 * 会话级阶段顺序。公共阶段必须依次出现；会话一旦进入信贷环节，
 * 信贷各阶段必须完整且依次出现（允许同一阶段出现多次，取首次定位）。
 */
export const COMMON_STAGES = ["ORDER_CONFIRMED", "PAYMENT_PRESENTED", "PAYMENT_METHOD_SELECTED"];

export const CREDIT_STAGES = [
  "CREDIT_DISCLOSED",
  "SUITABILITY_EVALUATED",
  "CREDIT_APPLICATION_SUBMITTED",
  "CREDIT_APPLICATION_DECIDED",
  "CREDIT_LINE_OPENED",
  "CONTRACT_PRESENTED",
  "CONTRACT_SIGNED",
  "LOAN_DISBURSED",
];

/**
 * 聚合级前置条件：同一聚合上，key 事件出现前必须先出现列表中的事件。
 */
export const AGGREGATE_PREREQUISITES = {
  PAYMENT_CAPTURED: ["PAYMENT_METHOD_SELECTED"],
  CREDIT_APPLICATION_DECIDED: ["CREDIT_APPLICATION_SUBMITTED"],
  CONTRACT_SIGNED: ["CONTRACT_PRESENTED"],
  LOAN_DISBURSED: ["CONTRACT_SIGNED"],
  REPAYMENT_RECEIVED: ["REPAYMENT_SCHEDULE_ISSUED"],
  REFUND_COMPLETED: ["REFUND_REQUESTED"],
  DISPUTE_RESOLVED: ["DISPUTE_OPENED"],
};

/** 适当性评估结果取值；只有 passed 才允许进入授信申请。 */
export const SUITABILITY_RESULTS = ["passed", "rejected", "manual_review"];
