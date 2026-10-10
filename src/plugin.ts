import { DEFAULT_SETTINGS } from "./settings";
import type { OneCommePlugin } from "./types";

export function createPlugin(): OneCommePlugin {
  let receivedCount = 0;

  return {
    name: "Live2Dマスコット連携（開発準備）",
    uid: "com.onecomme.live2d-mascot",
    version: "0.1.0",
    author: "maymehbird",
    url: "http://localhost:11180/plugins/com.onecomme.live2d-mascot/index.html",
    permissions: ["comments"],
    init() {
      receivedCount = 0;
    },
    destroy() {
      receivedCount = 0;
    },
    subscribe(type, ...args) {
      if (type !== "comments") return;
      const payload = args[0];
      if (!payload || typeof payload !== "object") return;
      const comments = (payload as { comments?: unknown }).comments;
      if (Array.isArray(comments)) receivedCount += comments.length;
      // TODO: 正規化、重複排除、フィルタ、キュー、WS送信を追加する。
    },
    async request(req) {
      if (req.method !== "GET") return { code: 405, response: { error: "準備段階のため参照のみ対応しています" } };
      return {
        code: 200,
        response: { stage: "scaffold", receivedCount, settings: { ...DEFAULT_SETTINGS }, connected: false },
      };
    },
  };
}
