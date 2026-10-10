/** マスコットbridge v1のsayメッセージ。 */
export interface SayMessage {
  v: 1;
  type: "say";
  payload: { text: string };
  ts: number;
}

export function createSayMessage(text: string, ts = Date.now()): SayMessage {
  return { v: 1, type: "say", payload: { text: Array.from(text).slice(0, 200).join("") }, ts };
}
