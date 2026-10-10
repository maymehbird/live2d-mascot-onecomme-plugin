import { test, expect } from "bun:test";
import { createPlugin } from "./plugin";

test("再接続はJSON文字列・解析済みオブジェクト・Bufferを受け付ける", async () => {
  const plugin = createPlugin();
  try {
    const value = {action: "connect", bridgeFile: ""};
    for (const body of [value, JSON.stringify(value), Buffer.from(JSON.stringify(value))]) {
      const result = await plugin.request({method: "POST", body});
      expect(result.code).toBe(200);
      expect(result.response.stage).toBe("speech");
    }
  } finally { plugin.destroy(); }
});

test("不正な再接続リクエストは拒否し、既存のパスを変更しない", async () => {
  const plugin = createPlugin();
  try {
    for (const body of [undefined, null, "{", "null", [], 1, {action: "connect", bridgeFile: 1}, {action: "unknown", bridgeFile: ""}]) {
      expect((await plugin.request({method: "POST", body})).code).toBe(400);
    }
    expect(((await plugin.request({method: "GET"})).response.settings as {bridgeFile: string}).bridgeFile).toBe("");
  } finally { plugin.destroy(); }
});
