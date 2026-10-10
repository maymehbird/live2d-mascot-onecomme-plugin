/** マスコットbridge v1のsayメッセージ。送信処理は後続の実装で追加する。 */
export interface SayMessage {
  v: 1;
  type: "say";
  payload: { text: string };
  ts: number;
}

export function createSayMessage(text: string, ts = Date.now()): SayMessage {
  return { v: 1, type: "say", payload: { text: text.slice(0, 200) }, ts };
}
