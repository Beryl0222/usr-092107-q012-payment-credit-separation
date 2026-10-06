/** 支付信贷分离网关使用的领域事件信封。 */
export interface DomainEvent {
  /** 全局唯一，接收后不得改写。 */
  event_id: string;
  event_type: EventType;
  aggregate_type: AggregateType;
  aggregate_id: string;
  /** 事件发生时间，接收后不得改写。 */
  occurred_at: string;
  /** 事件结构版本。 */
  version: number;
  /** 面向排查与重放的中文摘要。 */
  summary: string;
  /** 结账会话标识，把跨聚合的各环节串成可追踪的整体。 */
  session_id: string;
  /** 数据分类，决定哪些角色可以读取。 */
  data_classification: DataClassification;
  /** 允许读取的角色，必须是数据分类允许集合的子集，且始终包含 user。 */
  visible_to: Role[];
  /** 幂等键；收单、授信申请、开额度、放款、退款完成必填。 */
  idempotency_key?: string;
  /** 事件内容，按事件类型分别约束。 */
  payload: EventPayload;
}

export type EventType =
  | "ORDER_CONFIRMED"
  | "PRESENTATION_ARCHIVED"
  | "PAYMENT_PRESENTED"
  | "PAYMENT_METHOD_SELECTED"
  | "PAYMENT_CAPTURED"
  | "CREDIT_DISCLOSED"
  | "SUITABILITY_EVALUATED"
  | "CONSENT_CAPTURED"
  | "CREDIT_APPLICATION_SUBMITTED"
  | "CREDIT_APPLICATION_DECIDED"
  | "CREDIT_LINE_OPENED"
  | "CONTRACT_PRESENTED"
  | "CONTRACT_SIGNED"
  | "LOAN_DISBURSED"
  | "REPAYMENT_SCHEDULE_ISSUED"
  | "REPAYMENT_RECEIVED"
  | "REFUND_REQUESTED"
  | "REFUND_COMPLETED"
  | "OVERDUE_NOTICE_SENT"
  | "DISPUTE_OPENED"
  | "DISPUTE_RESOLVED"
  | "REPORT_CORRECTED"
  | "RECONFIRMATION_REQUIRED";

export type AggregateType =
  | "checkout_session"
  | "presentation"
  | "credit_offer"
  | "suitability_assessment"
  | "credit_application"
  | "credit_line"
  | "loan_contract"
  | "refund"
  | "overdue_notice"
  | "dispute"
  | "credit_correction";

export type Role =
  | "user"
  | "merchant"
  | "payment_institution"
  | "facilitation_platform"
  | "funding_party"
  | "customer_service"
  | "regulator"
  | "credit_bureau_agency";

export type DataClassification =
  | "order_info"
  | "payment_status"
  | "presentation_record"
  | "consent_record"
  | "credit_detail"
  | "contract"
  | "fund_flow"
  | "debt_detail"
  | "credit_bureau"
  | "dispute";

/** 谁放款、谁收费、谁催收；披露、合同、放款与催收通知之间必须一致。 */
export interface PartySet {
  lender: string;
  fee_collector: string;
  collector_party: string;
  facilitator?: string;
  payment_institution?: string;
}

export interface FundLeg {
  from: string;
  to: string;
  amount: number;
  channel?: string;
}

export interface PaymentOption {
  method_id: string;
  method_type: "balance" | "bank_card" | "credit";
  /** 让用户一眼区分支付还是借款的展示文案。 */
  label: string;
}

export interface CostBlock {
  /** 年化利率；同一报价内优惠前后口径一致。 */
  apr: number;
  total_cost: number;
  total_interest?: number;
}

export interface AgreementRef {
  agreement_id: string;
  title: string;
  version: string;
}

export type EventPayload =
  | OrderConfirmedPayload
  | PresentationArchivedPayload
  | PaymentPresentedPayload
  | PaymentMethodSelectedPayload
  | PaymentCapturedPayload
  | CreditDisclosedPayload
  | SuitabilityEvaluatedPayload
  | ConsentCapturedPayload
  | CreditApplicationSubmittedPayload
  | CreditApplicationDecidedPayload
  | CreditLineOpenedPayload
  | ContractPresentedPayload
  | ContractSignedPayload
  | LoanDisbursedPayload
  | RepaymentScheduleIssuedPayload
  | RepaymentReceivedPayload
  | RefundRequestedPayload
  | RefundCompletedPayload
  | OverdueNoticeSentPayload
  | DisputeOpenedPayload
  | DisputeResolvedPayload
  | ReportCorrectedPayload
  | ReconfirmationRequiredPayload;

export interface OrderConfirmedPayload {
  items: { sku: string; name: string; quantity: number; unit_price: number }[];
  total_amount: number;
  currency: string;
  merchant_id: string;
}

export interface PresentationArchivedPayload {
  page_id: string;
  page_version: string;
  /** 展示内容的摘要，重放时据此核对用户所见。 */
  content_hash: string;
  shown_options?: PaymentOption[];
  /** 不得指向信贷选项。 */
  default_method_id?: string | null;
  preselected_method_id?: string | null;
}

export interface PaymentPresentedPayload {
  presentation_id: string;
}

export interface PaymentMethodSelectedPayload {
  presentation_id: string;
  method_id: string;
  method_type: "balance" | "bank_card" | "credit";
  page_version: string;
  /** 必须由用户本人显式选择，系统不得代选。 */
  selected_by: "user";
}

export interface PaymentCapturedPayload {
  amount: number;
  currency: string;
  fund_path: FundLeg[];
}

export interface CreditDisclosedPayload {
  presentation_id: string;
  parties: PartySet;
  /** 成本计算口径，如 IRR；同一报价不得中途变更。 */
  calculation_method: string;
  currency: string;
  before_discount: CostBlock;
  after_discount: CostBlock;
  fees?: { name: string; amount: number; charged_by: string }[];
}

export interface SuitabilityEvaluatedPayload {
  result: "passed" | "rejected" | "manual_review";
  risk_level: string;
  model_version: string;
}

export interface ConsentCapturedPayload {
  presentation_id: string;
  consent_type: "bureau_query" | "agreement";
  /** consent_type 为 agreement 时必填，协议须逐项同意。 */
  agreement_id?: string;
  granted: boolean;
  page_version: string;
}

export interface CreditApplicationSubmittedPayload {
  requested_amount: number;
  currency: string;
}

export interface CreditApplicationDecidedPayload {
  decision: "approved" | "declined";
  /** 作出授信决定的资金方。 */
  decided_by: string;
}

export interface CreditLineOpenedPayload {
  approved_limit: number;
  currency: string;
  lender: string;
}

export interface ContractPresentedPayload {
  presentation_id: string;
  contract_version: string;
  content_hash: string;
  parties: PartySet;
  /** 展示的全部协议，不得折叠打包；每份须单独取得同意。 */
  agreements: AgreementRef[];
}

export interface ContractSignedPayload {
  presentation_id: string;
  contract_version: string;
  acknowledged_agreements: string[];
  signature_evidence: { method: string; evidence_hash: string };
}

export interface LoanDisbursedPayload {
  amount: number;
  currency: string;
  lender: string;
  credit_line_id: string;
  fund_path: FundLeg[];
}

export interface RepaymentScheduleIssuedPayload {
  installments: { installment_no: number; due_date: string; amount: number }[];
}

export interface RepaymentReceivedPayload {
  installment_no: number;
  amount: number;
  currency: string;
  channel: string;
}

export interface RefundRequestedPayload {
  reason: string;
  requested_amount: number;
  currency: string;
}

export interface RefundCompletedPayload {
  /** 按原资金路径的反向冲销，original_event_id 指向 PAYMENT_CAPTURED 或 LOAN_DISBURSED。 */
  reversals: { original_event_id: string; legs: FundLeg[] }[];
}

export interface OverdueNoticeSentPayload {
  contract_id: string;
  /** 必须与合同披露的催收方一致。 */
  collector_party: string;
  channel: string;
  amount_due: number;
  currency: string;
}

export interface DisputeOpenedPayload {
  category: string;
  related_contract_id: string;
  assignee_role: "customer_service" | "facilitation_platform" | "funding_party";
}

export interface DisputeResolvedPayload {
  resolution: string;
  resolver_role: "customer_service" | "facilitation_platform" | "funding_party";
}

export interface ReportCorrectedPayload {
  /** 被更正的原始记录；原记录保留，不删除。 */
  corrects_event_id: string;
  reason: string;
  corrected_fields: { field: string; reported_value: unknown; correct_value: unknown }[];
}

export interface ReconfirmationRequiredPayload {
  reason: "page_updated" | "contract_updated";
  new_page_version?: string;
  new_contract_version?: string;
}
