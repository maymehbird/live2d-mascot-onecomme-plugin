/** 設定画面・永続化の実装で共有する設定案。現段階では送信しない。 */
export interface PluginSettings {
  enabled: boolean;
  /** 空文字ならOS標準のマスコット設定フォルダから自動検出する予定。 */
  bridgeFile: string;
  messageTemplate: string;
  maxTextLength: number;
  sendIntervalMs: number;
  queueLimit: number;
  excludeOwnComments: boolean;
}

export const DEFAULT_SETTINGS: Readonly<PluginSettings> = Object.freeze({
  enabled: false,
  bridgeFile: "",
  messageTemplate: "{name}さん、{comment}",
  maxTextLength: 200,
  sendIntervalMs: 5000,
  queueLimit: 20,
  excludeOwnComments: true,
});
