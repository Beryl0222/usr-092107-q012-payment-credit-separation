# 支付信贷分离网关

本仓库记录该项目已确认的领域对象、事件名称和基础校验方式，便于不同系统交换一致的数据。

一次结账横跨商户、支付机构、助贷平台和资金方。网关把全流程拆成独立且可追踪的状态，用户每次所见内容均以领域事件留档，使用户在付款时一眼看出自己是在支付还是借款，并能在事后回答谁放款、谁收费、谁催收。

## 资料范围

- `contracts/domain.schema.json`：领域事件信封、聚合类型、事件名称与角色枚举。
- `data/sample.json`：一条用于本地联调的中文样例。
- `data/checkout-flow-sample.json`：一次结账从商品确认到征信更正的全生命周期样例。
- `src/`：事件信封与流程规则的最小校验代码。
- `tests/`：验证样例符合约定，并覆盖各类违规场景。

记录一经接收，标识、发生时间与版本不得原地改写；更正使用新的后继记录。个人、机构及商业敏感信息仅向履行职责所需的调用方开放。

## 流程状态与事件

| 状态 | 聚合 | 事件 |
| --- | --- | --- |
| 商品确认 | `checkout_session` | `SCREEN_PRESENTED`、`GOODS_CONFIRMED` |
| 支付选择 | `checkout_session` | `SCREEN_PRESENTED`、`PAYMENT_PRESENTED`、`PAYMENT_METHOD_SELECTED` |
| 综合融资成本 | `cost_disclosure` | `SCREEN_PRESENTED`、`COST_DISCLOSED` |
| 适当性评估 | `suitability_assessment` | `SUITABILITY_ASSESSED` |
| 授信申请 | `credit_application` | `CREDIT_APPLIED`、`CREDIT_DECIDED` |
| 电子签署 | `contract_signing` | `SCREEN_PRESENTED`、`CONTRACT_SIGNED`（同意记录 `CONSENT_CAPTURED` 挂在 `checkout_session`） |
| 放款 / 还款 | `loan_contract` | `LOAN_DISBURSED`、`REPAYMENT_RECORDED` |
| 退款撤销 | `refund` | `REFUND_REQUESTED`、`REFUND_SETTLED` |
| 逾期通知 | `overdue_notice` | `OVERDUE_NOTIFIED` |
| 争议处理 | `dispute` | `DISPUTE_OPENED`、`DISPUTE_RESOLVED` |
| 征信更正 | `credit_correction` | `REPORT_CORRECTED` |
| 页面或合同版本 | `terms_document` | `TERMS_UPDATED` |

同一结账流程的所有事件以 `checkout_id` 串联。`SCREEN_PRESENTED` 记录用户每次所见页面的 `content_uri` 与 `content_hash`，监管抽查可据此重放某次选择的展示与签署。

## 参与角色

`user`（用户）、`merchant`（商户）、`payment_institution`（支付机构）、`loan_facilitator`（助贷平台）、`funder`（资金方）、`collector`（催收机构）、`credit_bureau`（征信机构）、`customer_service`（客服）、`regulator`（监管）、`system`（平台系统）。

每条记录以 `actor_role` 标明触发者，以 `visibility` 列出可读取的角色，最小必要开放。

## 已确认规则

`src/validator.js` 将以下规则落实为可机器执行的校验：

1. **信贷不得预选**：`PAYMENT_PRESENTED.credit_preselected` 与 `PAYMENT_METHOD_SELECTED.preselected` 必须为 `false`，支付方式由用户主动选择。
2. **成本同一口径**：`COST_DISCLOSED` 必须同时给出 `apr_before_discount` 与 `apr_after_discount`，并共用同一个 `calculation_method`；每项费用标明 `charged_by`（谁收费）。
3. **责任方可追溯**：`LOAN_DISBURSED` 必须标明 `funder`（谁放款），`OVERDUE_NOTIFIED` 必须标明 `collector`（谁催收）。
4. **重试幂等**：授信申请、授信结果、放款、退款、还款必须携带 `idempotency_key`，同一事件类型的幂等键不得重复，网络重试不得重复开额度或放款。
5. **版本更新重新确认**：`TERMS_UPDATED` 之后，未完成流程的 `CONSENT_CAPTURED` 与 `CONTRACT_SIGNED` 必须使用最新 `terms_version`。
6. **签署可重放**：`CONTRACT_SIGNED` 必须以 `references` 关联所展示的页面与确认记录，且被关联记录真实存在。
7. **商户隔离**：`suitability_assessment`、`credit_application`、`credit_correction` 的 `visibility` 不得包含 `merchant`，商户不能读取征信与负债。
8. **客服最小权限**：`customer_service` 只能出现在合同（`contract_signing`、`loan_contract`）与争议（`dispute`）记录的 `visibility` 中。
9. **退款按资金路径冲销**：`REFUND_SETTLED` 必须以 `references` 指向原 `LOAN_DISBURSED`，并记录实际 `fund_path`。
10. **更正不删历史**：`REPORT_CORRECTED` 必须以 `references` 指向原记录，且原记录保留在事件序列中。

## 本地检查

```bash
node --test
```
