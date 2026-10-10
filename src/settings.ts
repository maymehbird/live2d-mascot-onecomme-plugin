/** 接続・コメント送信設定。初期状態ではコメント送信を無効にする。 */
export interface PluginSettings {
  enabled: boolean;
  /** 空文字ならOS標準のマスコット設定フォルダから自動検出する。 */
  bridgeFile: string;
  messageTemplate: string;
  maxTextLength: number;
  sendIntervalMs: number;
  queueLimit: number;
  queueMaxAgeSeconds: number;
  queueOverflow: "dropOldest" | "dropNewest";
  excludeOwnComments: boolean;
  ownUserIds: string;
  fallbackName: string;
  fallbackMode: "name" | "commentOnly";
  honorific: string;
}

export const DEFAULT_SETTINGS: Readonly<PluginSettings> = Object.freeze({
  enabled: false,
  bridgeFile: "",
  messageTemplate: "{name}{honorific}、{comment}",
  maxTextLength: 200,
  sendIntervalMs: 5000,
  queueLimit: 20,
  queueMaxAgeSeconds: 60,
  queueOverflow: "dropOldest",
  excludeOwnComments: true,
  ownUserIds: "",
  fallbackName: "視聴者",
  fallbackMode: "name",
  honorific: "さん",
});

export function validateSettings(value: unknown): PluginSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("設定はオブジェクトで指定してください");
  const v = value as Record<string, unknown>;
  for (const key of ["enabled", "excludeOwnComments"] as const) {
    if (typeof v[key] !== "boolean") throw new Error(`${key}は真偽値で指定してください`);
  }
  for (const [key, limit] of [["bridgeFile", 4096], ["messageTemplate", 1000], ["ownUserIds", 4096], ["fallbackName", 100], ["honorific", 100]] as const) {
    if (typeof v[key] !== "string" || v[key].length > limit) throw new Error(`${key}が不正です`);
  }
  if (!(v.messageTemplate as string).includes("{comment}")) throw new Error("テンプレートに{comment}が必要です");
  for (const [key, min, max] of [["maxTextLength", 1, 200], ["sendIntervalMs", 1000, 60000], ["queueLimit", 1, 100], ["queueMaxAgeSeconds", 1, 3600]] as const) {
    if (!Number.isInteger(v[key]) || Number(v[key]) < min || Number(v[key]) > max) throw new Error(`${key}は${min}〜${max}の整数で指定してください`);
  }
  if (v.queueOverflow !== "dropOldest" && v.queueOverflow !== "dropNewest") throw new Error("キュー上限時の処理が不正です");
  if (v.fallbackMode !== "name" && v.fallbackMode !== "commentOnly") throw new Error("名前がないときの処理が不正です");
  if (v.fallbackMode === "name" && !(v.fallbackName as string).trim()) throw new Error("名前がないときの呼び名を入力するか、本文のみを選んでください");
  return {enabled: v.enabled as boolean, excludeOwnComments: v.excludeOwnComments as boolean,
    bridgeFile: (v.bridgeFile as string).trim(), messageTemplate: v.messageTemplate as string,
    ownUserIds: (v.ownUserIds as string).trim(), fallbackName: (v.fallbackName as string).trim(), fallbackMode: v.fallbackMode, maxTextLength: v.maxTextLength as number,
    sendIntervalMs: v.sendIntervalMs as number, queueLimit: v.queueLimit as number,
    queueMaxAgeSeconds: v.queueMaxAgeSeconds as number, queueOverflow: v.queueOverflow,
    honorific: v.honorific as string};
}

/** 旧形式の単純な名前＋本文テンプレートは、保存された呼び方を保って移行する。 */
export function loadSettings(value: unknown): PluginSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("設定が不正です");
  const original = value as Record<string, unknown>;
  const merged = {...DEFAULT_SETTINGS, ...original};
  if (typeof original.messageTemplate === "string" && original.messageTemplate.includes("{speaker}")) {
    const source = ["name", "nickname", "accountName", "screenName"].includes(String(original.nameSource)) ? String(original.nameSource) : "name";
    const separator = typeof original.nameSeparator === "string" ? original.nameSeparator : "、";
    merged.messageTemplate = original.messageTemplate.replace(/\{speaker\}/g, () => `{${source}}{honorific}${separator}`);
  } else if (!("honorific" in original) && typeof original.messageTemplate === "string") {
    const match = original.messageTemplate.match(/^\{(name|nickname|accountName|screenName)\}([^{}]*)\{comment\}$/);
    if (match) {
      const suffix = match[2]!.match(/^(.*?)([、,，:：\s]*)$/)!;
      merged.honorific = suffix[1]!;
      merged.messageTemplate = `{${match[1]}}{honorific}${suffix[2]}{comment}`;
    }
  }
  return validateSettings(merged);
}
