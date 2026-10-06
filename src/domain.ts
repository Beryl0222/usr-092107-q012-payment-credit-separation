/** 支付信贷分离网关中的参与角色。 */
export type ActorRole =
  | "user" // 用户本人
  | "merchant" // 商户
  | "payment_institution" // 支付机构
  | "loan_facilitator" // 助贷平台
  | "funder" // 资金方
  | "collector" // 催收机构
  | "credit_bureau" // 征信机构
  | "customer_service" // 客服
  | "regulator" // 监管
  | "system"; // 平台系统

/** 领域事件类型，每个流程状态对应一组事件。 */
export type EventType =
  | "GOODS_CONFIRMED" // 商品确认
  | "SCREEN_PRESENTED" // 用户所见页面留档（可重放）
  | "PAYMENT_PRESENTED" // 支付方式展示（信贷不得预选）
  | "PAYMENT_METHOD_SELECTED" // 支付选择
  | "COST_DISCLOSED" // 综合融资成本披露（优惠前后同一口径）
  | "CREDIT_DISCLOSED" // 信贷方案披露
  | "SUITABILITY_ASSESSED" // 适当性评估
  | "CREDIT_APPLIED" // 授信申请
  | "CREDIT_DECIDED" // 授信结果（开额度）
  | "CONSENT_CAPTURED" // 界面同意 / 重新确认
  | "CONTRACT_SIGNED" // 电子签署
  | "LOAN_DISBURSED" // 放款
  | "REPAYMENT_RECORDED" // 还款
  | "REFUND_REQUESTED" // 退款申请
  | "REFUND_SETTLED" // 退款冲销完成
  | "OVERDUE_NOTIFIED" // 逾期通知
  | "DISPUTE_OPENED" // 争议发起
  | "DISPUTE_RESOLVED" // 争议办结
  | "TERMS_UPDATED" // 页面或合同版本更新
  | "REPORT_CORRECTED"; // 征信更正（不删除历史）

/** 聚合类型，即被独立追踪的流程状态载体。 */
export type AggregateType =
  | "checkout_session" // 结账会话：商品确认、支付选择、同意
  | "cost_disclosure" // 综合融资成本
  | "credit_offer" // 信贷方案
  | "suitability_assessment" // 适当性评估
  | "credit_application" // 授信申请
  | "contract_signing" // 电子签署
  | "loan_contract" // 借款合同：放款与还款
  | "refund" // 退款撤销
  | "overdue_notice" // 逾期通知
  | "dispute" // 争议处理
  | "credit_correction" // 征信更正
  | "terms_document"; // 页面或合同版本

/** 支付信贷分离网关使用的领域事件信封。 */
export interface DomainEvent {
  event_id: string;
  event_type: EventType;
  aggregate_type: AggregateType;
  aggregate_id: string;
  occurred_at: string;
  version: number;
  summary: string;
  /** 贯穿一次结账全流程的标识。 */
  checkout_id?: string;
  /** 触发本记录的角色。 */
  actor_role?: ActorRole;
  /** 允许读取本记录的角色清单，最小必要开放。 */
  visibility?: ActorRole[];
  /** 有资金或授信副作用的事件必须携带，重试凭此去重。 */
  idempotency_key?: string;
  /** 记录所依据的页面或合同版本。 */
  terms_version?: string;
  /** 指向的前序记录：更正指向原记录、退款指向放款、签署指向所展示页面。 */
  references?: string[];
  /** 各事件类型的业务载荷。 */
  payload?: Record<string, unknown>;
}
