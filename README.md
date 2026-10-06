# 支付信贷分离网关

本仓库记录该项目已确认的领域对象、事件名称、合规规则与基础校验方式，便于商户、支付机构、助贷平台、资金方等系统交换一致的数据，并让每一次结账都能回答三个问题：**谁放款、谁收费、谁催收**。

一次结账被拆成独立且可追踪的环节：商品确认 → 支付选择 → 综合融资成本披露 → 适当性评估 → 授信申请 → 电子签署 → 放款 → 还款 → 退款撤销 → 逾期通知 → 争议处理。每个环节的所见内容都以 `PRESENTATION_ARCHIVED` 事件留档，监管可按会话重放。

## 资料范围

- `contracts/domain.schema.json`：领域事件信封（事件类型、聚合类型、数据分类、可见角色、幂等键）。
- `contracts/payloads.schema.json`：各事件类型的 payload 契约，是不变量校验依赖的字段约定。
- `src/policy.js`：事件目录与合规策略常量，是校验器与不变量共用的唯一事实来源。
- `src/validator.js`：单条事件信封校验。
- `src/invariants.js`：事件流级合规不变量（见下表）。
- `src/replay.js`：监管重放，按会话还原用户所见与确认动作。
- `src/domain.ts`：类型定义参考。
- `data/sample.json`：单条联调样例。
- `data/lifecycle/full-credit-journey.json`：信贷全链路样例（30 条事件，含一次页面更新后的重新确认）。
- `data/lifecycle/pure-payment-journey.json`：纯支付链路样例。
- `docs/lifecycle.md`：状态机与各环节的规则说明。
- `tests/`：信封契约测试与逐条不变量的正反向用例。

## 合规不变量

`validateStream(events)` 对完整事件流执行以下规则，任何一条不满足都会产出违规记录：

| 规则 | 含义 |
| --- | --- |
| `no-preselected-credit` | 信贷不得作为默认或预选支付方式；每个选项必须带让用户一眼区分支付还是借款的标签 |
| `cost-basis` | 同一报价的各次披露使用相同的计算方法与币种；优惠前后同口径，且优惠后不得更贵 |
| `reconfirmation` | 页面或合同版本更新后，未完成的流程必须按新版本重新展示、重新确认 |
| `idempotency` | 收单、授信申请、开额度、放款、退款完成的幂等键不得重复，网络重试不产生重复副作用 |
| `visibility` | 调用方只能读取职责所需的数据分类：商户不见征信与负债，客服只接触合同与争议 |
| `refund-fund-path` | 退款按原资金路径反向冲销，累计退款不得超过原交易金额 |
| `correction-keeps-history` | 征信错误用引用原记录的更正记录修复，原记录保留，不得删除历史 |
| `presentation-archived` | 展示、选择、同意、披露、签署都必须引用已归档的展示留档 |
| `agreement-consent` | 合同展示的每份协议都必须有独立的同意记录，签署时逐项确认，不得折叠打包 |
| `party-consistency` | 披露、合同、放款、催收通知中的放款方、收费方、催收方必须一致 |
| `session-stage-order` | 会话内各环节必须按既定顺序完成，不得跳步 |
| `suitability-gate` | 适当性评估通过前不得提交授信申请 |
| `aggregate-prerequisite` | 同一聚合上关键事件按序出现（如先展示合同才能签署、先签署才能放款） |
| `disbursement-limit` | 放款金额不得超过已开通的授信额度 |
| `repayment-schedule` | 还款必须对应还款计划中的期次 |

## 数据可见性

每条事件携带 `data_classification` 与 `visible_to`，`visible_to` 必须是该分类允许角色集合的子集，且始终包含用户本人。分类与角色的对应关系登记在 `src/policy.js` 的 `ALLOWED_READERS`：商户只能读取订单与支付状态；客服只能读取合同与争议；征信与负债明细仅向用户本人、助贷平台、资金方、征信机构与监管开放。

## 需求追溯

| 合规要求 | 落实方式 |
| --- | --- |
| 一眼看出支付还是借款 | 展示留档中的选项标签与类型；`no-preselected-credit` |
| 事后回答谁放款、谁收费、谁催收 | 披露与合同中的 `parties`；`party-consistency` |
| 各环节独立且可追踪 | 事件目录与 `session_id` 串联；`session-stage-order`、`aggregate-prerequisite` |
| 所见内容留档 | `PRESENTATION_ARCHIVED`；`presentation-archived` |
| 信贷不能预选 | `no-preselected-credit` |
| 优惠前后成本同一口径 | `cost-basis` |
| 页面或合同更新须重新确认 | `RECONFIRMATION_REQUIRED`；`reconfirmation` |
| 重试不得重复开额度或放款 | 信封幂等键；`idempotency` |
| 商户不能读取征信与负债 | 数据分类与可见角色；`visibility` |
| 退款按实际资金路径冲销 | `refund-fund-path` |
| 错误征信用更正记录修复 | `REPORT_CORRECTED`；`correction-keeps-history` |
| 监管可重放展示与签署 | `src/replay.js`；`presentation-archived` |
| 客服只接触职责内的合同与争议 | 数据分类与可见角色；`visibility` |

记录一经接收，标识、发生时间与版本不得原地改写；更正使用新的后继记录。个人、机构及商业敏感信息仅向履行职责所需的调用方开放。

## 本地检查

```bash
node --test
```
