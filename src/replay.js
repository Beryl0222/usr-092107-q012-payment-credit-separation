/**
 * 监管重放：把某次结账会话的展示、选择、同意与签署按时间重排，
 * 并将每个确认动作与其引用的展示留档内容合并，供抽查时还原用户所见。
 */

/**
 * 返回会话时间线。每个条目包含事件本身，以及（如有的）所引用展示留档的
 * 完整内容，监管可据此核对“用户当时看到了什么、确认了什么”。
 */
export function replaySession(events, sessionId) {
  const presentations = new Map();
  for (const event of events) {
    if (event.event_type === "PRESENTATION_ARCHIVED" && event.session_id === sessionId) {
      presentations.set(event.aggregate_id, event);
    }
  }

  return events
    .filter((event) => event.session_id === sessionId)
    .slice()
    .sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at))
    .map((event) => {
      const presentationId = event.payload?.presentation_id;
      return {
        occurred_at: event.occurred_at,
        event_id: event.event_id,
        event_type: event.event_type,
        aggregate: `${event.aggregate_type}/${event.aggregate_id}`,
        summary: event.summary,
        payload: event.payload,
        presentation: presentationId ? presentations.get(presentationId)?.payload ?? null : null,
      };
    });
}

/**
 * 重放某次具体选择：给出该事件发生时用户所见内容与其确认结果的对应关系。
 * 用于回答“这次选择是不是用户本人在看到完整信息后作出的”。
 */
export function replayChoice(events, eventId) {
  const event = events.find((candidate) => candidate.event_id === eventId);
  if (!event) return null;
  const timeline = replaySession(events, event.session_id);
  return timeline.find((entry) => entry.event_id === eventId) ?? null;
}
