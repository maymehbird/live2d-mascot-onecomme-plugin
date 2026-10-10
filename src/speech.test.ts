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
  private isOnline = true;
  fakeConnectedAt = Date.now();
  fakeConnectionId = 1;
  get online() { return this.isOnline; }
  set online(value: boolean) {
    if (value && !this.isOnline) { this.fakeConnectedAt = Date.now(); this.fakeConnectionId++; }
    this.isOnline = value;
  }
  texts: string[] = [];
  times: number[] = [];
  override start() { if (this.online) { this.fakeConnectedAt = Date.now(); this.fakeConnectionId++; } }
  override stop() {}
  override status() { return {state: "connected" as const, connected: this.online,
    connectedAt: this.online ? this.fakeConnectedAt : null, connectionId: this.fakeConnectionId, bridgeFile: "", error: null}; }
  override async say(text: string) { this.texts.push(text); this.times.push(Date.now()); return true; }
}
const event = (id: string, comment = "<b>こんにちは</b>", userId = "viewer") =>
  ({service: "youtube", data: {liveId: "live", id, userId, name: "花子", comment, timestamp: Date.now()}});

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
  const bridge = new FakeBridge();
  const plugin = createPlugin({settingsFile: path.join(dir, "settings.json"), bridge});
  try {
    plugin.init(null);
    const settings = {...DEFAULT_SETTINGS, enabled: true, queueLimit: 1};
    await plugin.request({method: "POST", body: {action: "settings", settings}});
    plugin.subscribe("comments", {comments: [event("initial")]});
    await Bun.sleep(5);
    plugin.subscribe("comments", {comments: [event("1")]});
    plugin.subscribe("comments", {comments: [event("1"), event("2")]});
    let status = (await plugin.request({method: "GET"})).response;
    expect(status.queuedCount).toBe(1); expect(status.droppedCount).toBe(1);
    await plugin.request({method: "POST", body: {action: "settings", settings: {...settings, honorific: "さま"}}});
    expect((await plugin.request({method: "GET"})).response.queuedCount).toBe(1);
    expect((await plugin.request({method: "POST", body: {action: "settings", settings: {...settings, sendIntervalMs: 0}}})).code).toBe(400);
    await plugin.request({method: "POST", body: {action: "settings", settings: {...settings, enabled: false}}});
    status = (await plugin.request({method: "GET"})).response;
    expect(status.queuedCount).toBe(0);
    expect(status.droppedCount).toBe(2);
    bridge.online = false;
    expect((await plugin.request({method: "POST", body: {action: "test", text: "test"}})).code).toBe(409);
    bridge.online = true;
    expect((await plugin.request({method: "POST", body: {action: "test", text: "手動テスト"}})).code).toBe(200);
    await Bun.sleep(5); expect(bridge.texts).toEqual(["花子さん、こんにちは"]);
    expect((await plugin.request({method: "GET"})).response.queuedCount).toBe(1);
  } finally { plugin.destroy(); await rm(dir, {recursive: true}); }
});

test("接続時刻で初回の新着と履歴を分け、再接続で古い待機を破棄する", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "mascot-latest-"));
  const bridge = new FakeBridge(); bridge.online = false;
  const plugin = createPlugin({settingsFile: path.join(dir, "settings.json"), bridge});
  const timed = (id: string, timestamp: unknown) => ({...event(id, id), data: {...event(id, id).data, timestamp}});
  try {
    plugin.init(null);
    await plugin.request({method: "POST", body: {action: "settings", settings: {...DEFAULT_SETTINGS, enabled: true}}});
    plugin.subscribe("comments", {comments: [event("offline")]});
    expect((await plugin.request({method: "GET"})).response.queuedCount).toBe(0);
    bridge.online = true;
    const connectedAt = bridge.fakeConnectedAt;
    plugin.subscribe("comments", {comments: []});
    plugin.subscribe("comments", {comments: [timed("old-ms", connectedAt - 1),
      timed("old-seconds", Math.floor(connectedAt / 1000) - 60),
      timed("old-iso", new Date(connectedAt - 60000).toISOString()),
      timed("new1", connectedAt), timed("new2", String(connectedAt + 1)),
      timed("unknown", undefined), timed("invalid", "invalid")]});
    await Bun.sleep(5);
    expect(bridge.texts).toEqual(["花子さん、new1"]);
    expect((await plugin.request({method: "GET"})).response.queuedCount).toBe(2);
    expect((await plugin.request({method: "GET"})).response.ignoredStartupCount).toBe(5);
    // 同じ接続内で複数回に分かれた履歴や既知IDが届いても読まない。
    plugin.subscribe("comments", {comments: [timed("late-history", connectedAt - 1000), timed("new1", connectedAt)]});
    expect((await plugin.request({method: "GET"})).response.queuedCount).toBe(2);
    // ポーリングの間に切断・再接続が完了しても、接続IDで待機を破棄する。
    bridge.online = false;
    bridge.online = true;
    const reconnectedAt = bridge.fakeConnectedAt;
    plugin.subscribe("comments", {comments: [timed("during-outage", reconnectedAt - 1),
      timed("offline", reconnectedAt), timed("fresh", reconnectedAt), timed("fresh", reconnectedAt)]});
    const status = (await plugin.request({method: "GET"})).response;
    expect(status.connectedAt).toBe(reconnectedAt);
    expect(status.droppedCount).toBe(2);
    expect(status.queuedCount).toBe(1);
    expect(status.ignoredStartupCount).toBe(7);
    expect(bridge.texts).toEqual(["花子さん、new1"]);
    // 接続中の新着だけが待機し、切断を検出すると待機も破棄する。
    bridge.online = false;
    expect((await plugin.request({method: "GET"})).response.queuedCount).toBe(0);
    expect((await plugin.request({method: "GET"})).response.droppedCount).toBe(3);
  } finally { plugin.destroy(); await rm(dir, {recursive: true}); }
});

test("各接続の初回は時刻不明の最後の1件だけ読み、以降は全件を重複なく読む", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "mascot-fallback-"));
  const bridge = new FakeBridge();
  const plugin = createPlugin({settingsFile: path.join(dir, "settings.json"), bridge});
  const unknown = (id: string) => ({...event(id, id), data: {...event(id, id).data, timestamp: undefined}});
  try {
    plugin.init(null);
    await plugin.request({method: "POST", body: {action: "settings", settings: {...DEFAULT_SETTINGS, enabled: true}}});
    plugin.subscribe("comments", {comments: []});
    plugin.subscribe("comments", {comments: [unknown("old"), unknown("latest"), unknown("latest"),
      {data: {id: "history", comment: "履歴", isHistory: true}},
      {data: {id: "self", comment: "自分", isSelf: true}}]});
    await Bun.sleep(5);
    expect(bridge.texts).toEqual(["花子さん、latest"]);
    expect((await plugin.request({method: "GET"})).response.ignoredStartupCount).toBe(1);
    plugin.subscribe("comments", {comments: [unknown("old"), unknown("latest"), unknown("a"), unknown("b")]});
    expect((await plugin.request({method: "GET"})).response.queuedCount).toBe(2);
    bridge.online = false; bridge.online = true;
    plugin.subscribe("comments", {comments: [unknown("re-old"), unknown("re-latest")]});
    const status = (await plugin.request({method: "GET"})).response;
    expect(status.queuedCount).toBe(1);
    expect(status.droppedCount).toBe(2);
    expect(status.ignoredStartupCount).toBe(2);
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
    const bridge = new FakeBridge();
    const plugin = createPlugin({settingsFile: path.join(dir, policy + ".json"), bridge});
    try {
      plugin.init(null);
      const settings = {...DEFAULT_SETTINGS, enabled: true, queueLimit: 2, queueMaxAgeSeconds: 2, sendIntervalMs: 1500, queueOverflow: policy};
      await plugin.request({method: "POST", body: {action: "settings", settings}});
      plugin.subscribe("comments", {comments: [event("baseline")]});
      await Bun.sleep(5);
      bridge.texts.length = 0;
      plugin.subscribe("comments", {comments: [event("a", "a"), event("b", "b"), event("c", "c")]});
      expect((await plugin.request({method: "GET"})).response.queuedCount).toBe(2);
      expect((await plugin.request({method: "GET"})).response.droppedCount).toBe(1);
      await Bun.sleep(1700);
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
}, 10000);
