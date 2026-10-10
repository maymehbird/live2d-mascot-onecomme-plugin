import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { DEFAULT_SETTINGS } from "./settings";

function screen() {
  const nodes: Record<string, any> = {};
  const html = readFileSync(new URL("../static/index.html", import.meta.url), "utf8");
  for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    const handlers: Record<string, ((event: unknown) => void)[]> = {};
    nodes[match[1]!] = {value: "", checked: false, textContent: "", hidden: false,
      type: match[0].match(/type="([^"]+)"/)?.[1] || "",
      addEventListener(type: string, callback: (event: unknown) => void) { (handlers[type] ||= []).push(callback); },
      emit(type: string) { for (const callback of handlers[type] || []) callback({isComposing: false}); this['on' + type]?.(); }};
  }
  const requests: any[] = [];
  let fail = false;
  let persisted: any = {...DEFAULT_SETTINGS};
  const context = createContext({document: {getElementById: (id: string) => nodes[id]}, setTimeout, clearTimeout,
    setInterval: () => 0,
    fetch: async (_: string, options: any) => {
      if (options?.body) {
        const body = JSON.parse(options.body);
        requests.push(body);
        await Bun.sleep(30);
        if (fail) return {ok: true, json: async () => ({code: 500, response: {error: "保存失敗"}})};
        persisted = body.settings;
      }
      return {ok: true, json: async () => ({code: 200, response: {settings: persisted,
        connection: {state: "connected"}, sentCount: 0, queuedCount: 0, droppedCount: 0, ignoredStartupCount: 0}})};
    }});
  runInContext(html.match(/<script>([\s\S]*?)<\/script>/)![1]!, context);
  return {nodes, requests, context, fail: (value: boolean) => { fail = value; }};
}

test("入力をまとめて自動保存し、状態取得で編集中の値を上書きしない", async () => {
  const ui = screen(); await Bun.sleep(5);
  ui.nodes.honorific.value = "さ"; ui.nodes.honorific.emit("input");
  ui.nodes.honorific.value = "さま"; ui.nodes.honorific.emit("input");
  await runInContext("refresh()", ui.context);
  expect(ui.nodes.honorific.value).toBe("さま");
  await Bun.sleep(600);
  expect(ui.requests.length).toBe(1);
  expect(ui.requests[0].settings.honorific).toBe("さま");
  expect(ui.nodes['save-status'].textContent).toBe("自動保存済み");
  ui.nodes.namePreset.value = "nickname"; ui.nodes.namePreset.emit("change");
  await Bun.sleep(80);
  expect(ui.requests[1].settings.messageTemplate).toBe("{nickname}{honorific}、{comment}");
});

test("保存失敗を表示し、再試行で入力を保持して保存できる", async () => {
  const ui = screen(); await Bun.sleep(5); ui.fail(true);
  ui.nodes.honorific.value = "ちゃん"; ui.nodes.honorific.emit("change");
  await Bun.sleep(80);
  expect(ui.nodes['save-status'].textContent).toContain("保存失敗");
  expect(ui.nodes.save.hidden).toBe(false);
  expect(ui.nodes.honorific.value).toBe("ちゃん");
  ui.fail(false); await ui.nodes.save.onclick();
  expect(ui.nodes['save-status'].textContent).toBe("自動保存済み");
  expect(ui.nodes.save.hidden).toBe(true);
});
