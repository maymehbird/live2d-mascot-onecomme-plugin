import type { PluginSettings } from "./settings";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string { return typeof value === "string" ? value : ""; }
/** コメント本来の時刻だけを使う。受信時刻は履歴にも新しい値が付くため使わない。 */
export function commentTimestamp(value: unknown): number | null {
  const timestamp = record(record(value).data).timestamp;
  let result: number;
  if (typeof timestamp === "number" || (typeof timestamp === "string" && timestamp.trim() && Number.isFinite(Number(timestamp)))) {
    const numeric = Number(timestamp);
    result = numeric < 100000000000 ? numeric * 1000 : numeric;
  } else if (typeof timestamp === "string" && /\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(timestamp)) {
    result = Date.parse(timestamp);
  } else return null;
  return Number.isFinite(result) && result > 0 ? result : null;
}
export function plainText(value: string): string {
  return value.replace(/<img\b[^>]*\balt=["']([^"']*)["'][^>]*>/gi, " $1 ")
    .replace(/<[^>]*>/g, " ").replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, entity =>
      ({"&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&nbsp;": " "}[entity]!))
    .replace(/\s+/g, " ").trim();
}
export function normalizeComment(value: unknown, settings: PluginSettings) {
  const root = record(value);
  const data = record(root.data);
  const comment = plainText(text(data.speechText) || text(data.comment));
  const userId = text(data.userId);
  const ownIds = settings.ownUserIds.split(/[\s,]+/).filter(Boolean);
  if (!comment || root.isHistory === true || data.isHistory === true || data.isPast === true ||
      (settings.excludeOwnComments && (data.isSelf === true || data.isMe === true || ownIds.includes(userId)))) return null;
  const nickname = plainText(text(data.nickname));
  const accountName = plainText(text(data.name));
  const screenName = plainText(text(data.screenName));
  const availableName = nickname || accountName || screenName;
  const name = availableName || (settings.fallbackMode === "name" ? plainText(settings.fallbackName) : "");
  const id = text(data.id);
  const scope = `${text(root.service)}:${text(data.liveId) || text(root.name)}`;
  const key = id ? `${scope}:${id}` : `${scope}:${userId}:${String(data.timestamp || "")}:${comment}`;
  const variables: Record<string, string> = {name, nickname, accountName, screenName, comment,
    honorific: name ? settings.honorific : ""};
  // 名前が空なら、隣接する敬称プレースホルダーと句読点・空白も省く。
  const template = settings.messageTemplate.replace(/\{(name|nickname|accountName|screenName)\}(?:\{honorific\})?[、。，,.!！?？:：;；\s]*/g,
    (part, field: string) => variables[field] ? part : "");
  const rendered = template.replace(/\{(name|nickname|accountName|screenName|honorific|comment)\}/g, (_, field: string) => variables[field]!);
  return {key, ttl: id || data.timestamp ? 30 * 60 * 1000 : 10000,
    text: Array.from(rendered).slice(0, settings.maxTextLength).join("")};
}
