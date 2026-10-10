import { test, expect } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MascotBridge } from "./bridge";
import { createPlugin } from "./plugin";
import { DEFAULT_SETTINGS, loadSettings } from "./settings";
import { normalizeComment, commentTimestamp } from "./comments";
import { createSayMessage } from "./protocol";

class FakeBridge extends MascotBridge {
  online = true;
  texts: string[] = [];
  times: number[] = [];
  override start() {}
  override stop() {}
  override status() { return {state: "connected" as const, connected: this.online, bridgeFile: "", error: null}; }
  override async say(text: string) { this.texts.push(text); this.times.push(Date.now()); return true; }
}
const event = (id: string, comment = "<b>こんにちは</b>", userId = "viewer") =>
  ({service: "youtube", data: {liveId: "live", id, userId, name: "花子", comment}});

test("正規化・テンプレート・絵文字・自己コメント・履歴の除外", () => {
  const settings = {...DEFAULT_SETTINGS, ownUserIds: "me"};
  expect(normalizeComment(event("1"), settings)?.text).toBe("花子さん、こんにちは");
  expect(normalizeComment(event("2", "hi", "me"), settings)).toBeNull();
  expect(normalizeComment({data: {comment: "old", isHistory: true}}, settings)).toBeNull();
  expect(normalizeComment({data: {comment: "own", isSelf: true}}, settings)).toBeNull();
  expect(normalizeComment(event("3", "😀"), {...settings, messageTemplate: "{comment}", maxTextLength: 1})?.text).toBe("😀");
  expect(createSayMessage("😀".repeat(201)).payload.text).toBe("😀".repeat(200));
});

test("初期送信無効・保存・重複排除・送信間隔・再起動復元", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "mascot-speech-"));
  const settingsFile = path.join(dir, "settings.json");
  const bridge = new FakeBridge();
  const plugin = createPlugin({settingsFile, bridge});
  try {
    plugin.init(null);
    plugin.subscribe("comments", {comments: [event("before")]});
    expect(bridge.texts.length).toBe(0);
    const settings = {...DEFAULT_SETTINGS, enabled: true, sendIntervalMs: 1000};
    expect((await plugin.request({method: "POST", body: {action: "settings", settings}})).code).toBe(200);
    expect(JSON.parse(await readFile(settingsFile, "utf8")).enabled).toBe(true);
    plugin.subscribe("comments", {comments: [event("before"), event("1"), event("1")]});
    await Bun.sleep(50);
    expect(bridge.texts.length).toBe(1);
    plugin.subscribe("comments", {comments: [event("1"), event("2")]});
    await Bun.sleep(1200);
    expect(bridge.texts.length).toBe(2);
    expect(bridge.times[1]! - bridge.times[0]!).toBeGreaterThanOrEqual(1000);
    plugin.destroy(); plugin.init(null);
    expect(((await plugin.request({method: "GET"})).response.settings as {enabled: boolean}).enabled).toBe(true);
  } finally { plugin.destroy(); await rm(dir, {recursive: true}); }
});

test("キュー上限・無効化時の破棄・設定検証・接続前テスト拒否", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "mascot-speech-"));
  const bridge = new FakeBridge(); bridge.online = false;
  const plugin = createPlugin({settingsFile: path.join(dir, "settings.json"), bridge});
  try {
    plugin.init(null);
    const settings = {...DEFAULT_SETTINGS, enabled: true, queueLimit: 1};
    await plugin.request({method: "POST", body: {action: "settings", settings}});
    plugin.subscribe("comments", {comments: [event("initial")]});
    plugin.subscribe("comments", {comments: [event("1")]});
    plugin.subscribe("comments", {comments: [event("1"), event("2")]});
    let status = (await plugin.request({method: "GET"})).response;
    expect(status.queuedCount).toBe(1); expect(status.droppedCount).toBe(1);
    await plugin.request({method: "POST", body: {action: "settings", settings: {...settings, honorific: "さま"}}});
    expect((await plugin.request({method: "GET"})).response.queuedCount).toBe(1);
    expect((await plugin.request({method: "POST", body: {action: "test", text: "test"}})).code).toBe(409);
    expect((await plugin.request({method: "POST", body: {action: "settings", settings: {...settings, sendIntervalMs: 0}}})).code).toBe(400);
    await plugin.request({method: "POST", body: {action: "settings", settings: {...settings, enabled: false}}});
    status = (await plugin.request({method: "GET"})).response;
    expect(status.queuedCount).toBe(0);
    bridge.online = true;
    expect((await plugin.request({method: "POST", body: {action: "test", text: "手動テスト"}})).code).toBe(200);
    await Bun.sleep(5); expect(bridge.texts).toEqual(["手動テスト"]);
  } finally { plugin.destroy(); await rm(dir, {recursive: true}); }
});

test("初回全件と複数回に分かれた起動前履歴を除外し、新着は全件を順番に読む", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "mascot-latest-"));
  const bridge = new FakeBridge(); bridge.online = false;
  const plugin = createPlugin({settingsFile: path.join(dir, "settings.json"), bridge});
  try {
    plugin.init(null);
    await plugin.request({method: "POST", body: {action: "settings", settings: {...DEFAULT_SETTINGS, enabled: true}}});
    const comments = Array.from({length: 100}, (_, i) => event(String(i), `コメント${i}`));
    plugin.subscribe("comments", {comments: []});
    plugin.subscribe("comments", {comments});
    const startedAt = (await plugin.request({method: "GET"})).response.startedAt as number;
    expect((await plugin.request({method: "GET"})).response.queuedCount).toBe(0);
    const timed = (id: string, timestamp: unknown) => ({...event(id, id), data: {...event(id, id).data, timestamp}});
    plugin.subscribe("comments", {comments: [timed("old-ms", startedAt - 60000), timed("old-seconds", Math.floor(startedAt / 1000) - 60),
      timed("old-iso", new Date(startedAt - 60000).toISOString()), timed("new1", startedAt + 1), timed("new2", String(startedAt + 2)), event("unknown", "unknown")]});
    expect((await plugin.request({method: "GET"})).response.queuedCount).toBe(3);
    expect((await plugin.request({method: "GET"})).response.ignoredStartupCount).toBe(103);
    bridge.online = true;
    await Bun.sleep(250);
    expect(bridge.texts).toEqual(["花子さん、new1"]);
    plugin.subscribe("comments", {comments});
    expect(bridge.texts.length).toBe(1);
    expect((await plugin.request({method: "GET"})).response.queuedCount).toBe(2);
  } finally { plugin.destroy(); await rm(dir, {recursive: true}); }
});

test("時刻形式の解釈と受信時刻の不使用", () => {
  const ms = 1791590400000;
  for (const timestamp of [ms, String(ms), ms / 1000, String(ms / 1000), new Date(ms).toISOString()]) {
    expect(commentTimestamp({data: {timestamp}})).toBe(ms);
  }
  for (const timestamp of [undefined, null, "", "invalid", -1, Infinity, "2026-10-10T10:00:00"]) {
    expect(commentTimestamp({data: {timestamp}, receivedAt: new Date(ms).toISOString()})).toBeNull();
  }
});

test("わんコメ名・アカウント表示名・スクリーン名を区別し、欠損時も混同しない", () => {
  const value = {data: {comment: "こんにちは", nickname: "わんコメ名", name: "アカウント名", screenName: "@handle"}};
  const settings = {...DEFAULT_SETTINGS, messageTemplate: "{name}|{nickname}|{accountName}|{screenName}|{comment}"};
  expect(normalizeComment(value, settings)?.text).toBe("わんコメ名|わんコメ名|アカウント名|@handle|こんにちは");
  expect(normalizeComment({data: {...value.data, nickname: undefined}}, settings)?.text).toBe("アカウント名||アカウント名|@handle|こんにちは");
  expect(normalizeComment({data: {comment: "本文"}}, settings)?.text).toBe("視聴者||||本文");
  expect(normalizeComment({data: {...value.data, nickname: " <b>花子</b> "}}, {...settings, messageTemplate: "{nickname}:{accountName}:{comment}"})?.text)
    .toBe("花子:アカウント名:こんにちは");
  expect(normalizeComment({data: {...value.data, nickname: "{accountName}"}}, {...settings, messageTemplate: "{nickname}:{comment}"})?.text)
    .toBe("{accountName}:こんにちは");
});

test("最後のフォールバックだけ呼び名を変更・省略し、名前がある場合は通常どおり読む", () => {
  const unnamed = {data: {comment: "こんにちは"}};
  expect(normalizeComment(unnamed, {...DEFAULT_SETTINGS, fallbackName: "リスナー"})?.text).toBe("リスナーさん、こんにちは");
  const settings = {...DEFAULT_SETTINGS, fallbackMode: "commentOnly" as const};
  expect(normalizeComment(unnamed, settings)?.text).toBe("こんにちは");
  expect(normalizeComment(event("named"), settings)?.text).toBe("花子さん、こんにちは");
  expect(normalizeComment({data: {comment: "こんにちは", nickname: "わんコメ名"}}, settings)?.text).toBe("わんコメ名さん、こんにちは");
  expect(normalizeComment({data: {comment: "こんにちは", screenName: "@handle"}}, settings)?.text).toBe("@handleさん、こんにちは");
});

test("敬称・区切りを変更しても名前がなければまとめて省略し、テンプレートの他の部分は保つ", () => {
  const settings = {...DEFAULT_SETTINGS, honorific: "さま", fallbackMode: "commentOnly" as const,
    messageTemplate: "お便りです。{name}{honorific}。{comment}"};
  expect(normalizeComment(event("named"), settings)?.text).toBe("お便りです。花子さま。こんにちは");
  expect(normalizeComment({data: {comment: "こんにちは"}}, settings)?.text).toBe("お便りです。こんにちは");
  expect(normalizeComment(event("none"), {...settings, honorific: "", messageTemplate: "お便りです。{name}{honorific}{comment}"})?.text).toBe("お便りです。花子こんにちは");
  expect(normalizeComment(event("missingNickname"), {...settings, messageTemplate: "お便りです。{nickname}{honorific}、{comment}"})?.text).toBe("お便りです。こんにちは");
  const migrated = loadSettings({messageTemplate: "{nickname}ちゃん、{comment}", enabled: true});
  expect(migrated.honorific).toBe("ちゃん");
  expect(migrated.messageTemplate).toBe("{nickname}{honorific}、{comment}");
  expect(loadSettings({messageTemplate: "{speaker}{comment}", nameSource: "accountName", honorific: "さま", nameSeparator: "。"}).messageTemplate)
    .toBe("{accountName}{honorific}。{comment}");
  expect(loadSettings({messageTemplate: "本文: {comment}"}).messageTemplate).toBe("本文: {comment}");
});

test("上限時の両方の破棄方針と待機期限を守る", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "mascot-overflow-"));
  for (const policy of ["dropOldest", "dropNewest"] as const) {
    const bridge = new FakeBridge(); bridge.online = false;
    const plugin = createPlugin({settingsFile: path.join(dir, policy + ".json"), bridge});
    try {
      plugin.init(null);
      const settings = {...DEFAULT_SETTINGS, enabled: true, queueLimit: 2, queueMaxAgeSeconds: 1, queueOverflow: policy};
      await plugin.request({method: "POST", body: {action: "settings", settings}});
      plugin.subscribe("comments", {comments: [event("baseline")]});
      plugin.subscribe("comments", {comments: [event("a", "a"), event("b", "b"), event("c", "c")]});
      expect((await plugin.request({method: "GET"})).response.queuedCount).toBe(2);
      expect((await plugin.request({method: "GET"})).response.droppedCount).toBe(1);
      bridge.online = true;
      await Bun.sleep(250);
      expect(bridge.texts).toEqual([`花子さん、${policy === "dropOldest" ? "b" : "a"}`]);
      await Bun.sleep(1100);
      expect((await plugin.request({method: "GET"})).response.queuedCount).toBe(0);
      expect(bridge.texts.length).toBe(1);
      expect((await plugin.request({method: "GET"})).response.droppedCount).toBe(2);
      expect((await plugin.request({method: "POST", body: {action: "settings", settings: {...settings, queueMaxAgeSeconds: 0}}})).code).toBe(400);
      expect((await plugin.request({method: "POST", body: {action: "settings", settings: {...settings, queueOverflow: "invalid"}}})).code).toBe(400);
    } finally { plugin.destroy(); }
  }
  await rm(dir, {recursive: true});
});
