import {
  AGGREGATE_TYPES,
  DATA_CLASSIFICATIONS,
  EVENT_SPEC,
  EVENT_TYPES,
  IDEMPOTENCY_REQUIRED,
  ROLES,
} from "./policy.js";

const required = [
  "event_id",
  "event_type",
  "aggregate_type",
  "aggregate_id",
  "occurred_at",
  "version",
  "summary",
  "session_id",
  "data_classification",
  "visible_to",
  "payload",
];

/**
 * 校验单条事件信封的结构与目录登记是否一致。
 * 返回错误信息数组，空数组表示通过。跨事件的合规规则见 invariants.js。
 */
export function validateEvent(record) {
  const errors = [];
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    return ["事件必须是对象"];
  }

  for (const name of required) {
    if (!(name in record)) errors.push(`缺少字段：${name}`);
  }
  if (errors.length > 0) return errors;

  if (typeof record.event_id !== "string" || record.event_id.length === 0) errors.push("event_id 必须是非空字符串");
  if (typeof record.aggregate_id !== "string" || record.aggregate_id.length === 0) {
    errors.push("aggregate_id 必须是非空字符串");
  }
  if (typeof record.session_id !== "string" || record.session_id.length === 0) {
    errors.push("session_id 必须是非空字符串");
  }
  if (typeof record.summary !== "string" || record.summary.length === 0) errors.push("summary 必须是非空字符串");
  if (typeof record.occurred_at !== "string" || Number.isNaN(Date.parse(record.occurred_at))) {
    errors.push("occurred_at 必须是可解析的时间字符串");
  }
  if (!Number.isInteger(record.version) || record.version < 1) errors.push("version 必须是正整数");

  if (!EVENT_TYPES.includes(record.event_type)) {
    errors.push(`未登记的事件类型：${record.event_type}`);
    return errors; // 类型未登记时无法继续核对聚合与分类
  }
  const spec = EVENT_SPEC[record.event_type];

  if (!AGGREGATE_TYPES.includes(record.aggregate_type)) {
    errors.push(`未登记的聚合类型：${record.aggregate_type}`);
  } else if (!spec.aggregates.includes(record.aggregate_type)) {
    errors.push(`${record.event_type} 不允许挂在聚合 ${record.aggregate_type} 上`);
  }

  if (!DATA_CLASSIFICATIONS.includes(record.data_classification)) {
    errors.push(`未登记的数据分类：${record.data_classification}`);
  } else if (!spec.classifications.includes(record.data_classification)) {
    errors.push(`${record.event_type} 不允许使用数据分类 ${record.data_classification}`);
  }

  if (!Array.isArray(record.visible_to) || record.visible_to.length === 0) {
    errors.push("visible_to 必须是非空数组");
  } else {
    for (const role of record.visible_to) {
      if (!ROLES.includes(role)) errors.push(`未登记的角色：${role}`);
    }
    if (!record.visible_to.includes("user")) errors.push("visible_to 必须包含用户本人（user）");
  }

  if (IDEMPOTENCY_REQUIRED.includes(record.event_type)) {
    if (typeof record.idempotency_key !== "string" || record.idempotency_key.length === 0) {
      errors.push(`${record.event_type} 必须携带 idempotency_key，防止重试造成重复副作用`);
    }
  }

  if (record.payload === null || typeof record.payload !== "object" || Array.isArray(record.payload)) {
    errors.push("payload 必须是对象");
  }

  return errors;
}
