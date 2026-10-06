# 生命周期与环节规则

本文档说明支付信贷分离网关各环节的状态顺序，以及重新确认、幂等、退款、更正四条横切规则。可执行的校验见 `src/invariants.js`，常量登记在 `src/policy.js`。

## 状态顺序

### 公共阶段（每次结账必经）

```
ORDER_CONFIRMED → PAYMENT_PRESENTED → PAYMENT_METHOD_SELECTED
```

1. **商品确认**（`ORDER_CONFIRMED`）：订单内容、金额与商户确定，此后不得更改；要改订单须作废会话重新开始。
2. **支付选择**（`PAYMENT_PRESENTED` → `PAYMENT_METHOD_SELECTED`）：支付方式并列展示，信贷选项必须标明“借款”字样，不得默认或预选；选择必须由用户本人显式作出（`selected_by: user`）。

选择纯支付（余额、银行卡）的会话由支付机构收单（`PAYMENT_CAPTURED`）后结束；选择信贷的会话进入下列信贷阶段。

### 信贷阶段（选择信贷后必经，不得跳步）

```
CREDIT_DISCLOSED → SUITABILITY_EVALUATED → CREDIT_APPLICATION_SUBMITTED
→ CREDIT_APPLICATION_DECIDED → CREDIT_LINE_OPENED
→ CONTRACT_PRESENTED → CONTRACT_SIGNED → LOAN_DISBURSED
```

3. **综合融资成本披露**（`CREDIT_DISCLOSED`）：以同一计算方法（如 IRR）披露优惠前与优惠后的年化利率和总成本，并明示放款方、收费方、催收方。
4. **适当性评估**（`SUITABILITY_EVALUATED`）：评估通过（`passed`）才允许提交授信申请。
5. **授信申请**（`CREDIT_APPLICATION_SUBMITTED` / `CREDIT_APPLICATION_DECIDED`）：申请前须取得征信查询授权（`CONSENT_CAPTURED`，`consent_type: bureau_query`）；授信决定由资金方作出。
6. **电子签署**（`CONTRACT_PRESENTED` → `CONTRACT_SIGNED`）：合同展示须列出全部协议，每份协议单独取得同意（`consent_type: agreement`），签署时逐项确认；合同主体必须与成本披露一致。
7. **放款**（`LOAN_DISBURSED`）：金额不得超过已开通额度，放款方必须与合同一致，资金路径完整记录。

### 贷后环节

8. **还款**（`REPAYMENT_SCHEDULE_ISSUED` → `REPAYMENT_RECEIVED`）：还款必须对应计划中的期次。
9. **退款撤销**（`REFUND_REQUESTED` → `REFUND_COMPLETED`）：见下文退款规则。
10. **逾期通知**（`OVERDUE_NOTICE_SENT`）：发送方必须是合同披露的催收方。
11. **争议处理**（`DISPUTE_OPENED` → `DISPUTE_RESOLVED`）：先立案后办结；客服只能接触合同与争议两类数据。

## 重新确认

页面或合同内容更新时，平台发出 `RECONFIRMATION_REQUIRED`，给出新的页面版本或合同版本。此后：

- 必须按新版本重新展示（新的 `PRESENTATION_ARCHIVED` 或 `CONTRACT_PRESENTED`），才能继续记录用户确认；
- 用户的确认动作（选择支付方式、同意、签署）所用版本不得低于最新要求；
- 已完成的环节不受影响，规则只约束未完成的流程。

## 幂等

`PAYMENT_CAPTURED`、`CREDIT_APPLICATION_SUBMITTED`、`CREDIT_LINE_OPENED`、`LOAN_DISBURSED`、`REFUND_COMPLETED` 必须在信封携带 `idempotency_key`。同一事件类型的同一幂等键在事件流中只允许出现一次；网络重试使用相同幂等键，不得重复开额度或放款。

## 退款

退款完成时必须记录 `reversals`：每条冲销引用原始资金事件（`PAYMENT_CAPTURED` 或 `LOAN_DISBURSED`），其流水方向与原资金路径相反、金额不超过原流水；对同一原始事件的累计退款不得超过原交易金额。商户只收到退款状态，资金明细不向商户开放。

## 征信更正

报送错误用 `REPORT_CORRECTED` 修复：更正记录引用仍保留在事件流中的原始记录（`corrects_event_id`），说明原因并列出更正字段。事件目录中没有删除类事件，历史记录不得移除；更正与原记录共同构成完整事实链。
