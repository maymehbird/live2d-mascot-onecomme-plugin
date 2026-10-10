import { readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import { DEFAULT_SETTINGS, validateSettings, loadSettings, type PluginSettings } from "./settings";
import { MascotBridge } from "./bridge";
import { normalizeComment, commentTimestamp } from "./comments";
import { pickBridgeFile } from "./file-picker";
import type { OneCommePlugin } from "./types";

export function createPlugin(options: {settingsFile?: string; bridge?: MascotBridge} = {}): OneCommePlugin {
  const settingsFile = options.settingsFile || path.join(__dirname, "settings.json");
  const bridge = options.bridge || new MascotBridge();
  let settings: PluginSettings = {...DEFAULT_SETTINGS};
  let receivedCount = 0, sentCount = 0, droppedCount = 0, lastSent = 0;
  let startedAt = 0, ignoredStartupCount = 0;
  let connectionId: number | null = null;
  let initialBatchPending = true;
  let running = false, sending = false, generation = 0;
  let settingsError: string | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  const queue: {text: string; expires: number}[] = [];
  const seen = new Map<string, number>();
  const save = (next: PluginSettings) => {
    const temp = settingsFile + ".tmp";
    writeFileSync(temp, JSON.stringify(next, null, 2), {encoding: "utf8", mode: 0o600});
    renameSync(temp, settingsFile);
    settings = next; settingsError = null;
  };
  const clearQueue = () => { droppedCount += queue.length; queue.length = 0; };
  const syncConnection = () => {
    const connection = bridge.status();
    const nextId = connection.connected ? connection.connectionId : null;
    // 短い切断をポーリングで見逃しても接続IDの変化で古い待機を破棄する。
    if (nextId !== connectionId) { clearQueue(); connectionId = nextId; initialBatchPending = true; }
    return connection;
  };
  const expireQueue = () => {
    while (queue[0] && queue[0].expires <= Date.now()) { queue.shift(); droppedCount++; }
  };
  const flush = async () => {
    const connection = syncConnection();
    expireQueue();
    if (!running || sending || !queue.length || !connection.connected || Date.now() - lastSent < settings.sendIntervalMs) return;
    sending = true;
    const epoch = generation;
    const item = queue.shift()!;
    const ok = await bridge.say(item.text);
    if (epoch === generation) {
      if (ok) sentCount++; else droppedCount++;
      lastSent = Date.now(); sending = false;
    }
  };
  const enqueue = (text: string) => {
    expireQueue();
    if (queue.length >= settings.queueLimit) {
      droppedCount++;
      if (settings.queueOverflow === "dropNewest") return false;
      queue.shift();
    }
    queue.push({text, expires: Date.now() + settings.queueMaxAgeSeconds * 1000}); void flush(); return true;
  };
  const snapshot = () => {
    const connection = syncConnection();
    return {stage: "speech", receivedCount, sentCount, droppedCount, queuedCount: queue.length,
      ignoredStartupCount, initialBatchPending, startedAt, connectedAt: connection.connectedAt,
      settings: {...settings}, settingsError, connected: connection.connected, connection};
  };
  return {
    name: "Live2Dマスコット連携", uid: "com.onecomme.live2d-mascot", version: "0.2.1", author: "maymehbird",
    url: "http://localhost:11180/plugins/com.onecomme.live2d-mascot/index.html", permissions: ["comments"],
    init() {
      generation++; running = true; sending = false;
      clearInterval(timer); queue.length = 0; seen.clear();
      receivedCount = sentCount = droppedCount = lastSent = 0;
      startedAt = Date.now(); ignoredStartupCount = 0; connectionId = null; initialBatchPending = true;
      settings = {...DEFAULT_SETTINGS}; settingsError = null;
      try { settings = loadSettings(JSON.parse(readFileSync(settingsFile, "utf8"))); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") settingsError = "設定を読み込めなかったため、送信無効の初期値で開始しました。";
      }
      bridge.start(settings.bridgeFile);
      timer = setInterval(() => void flush(), 200); timer.unref();
    },
    destroy() {
      generation++; running = false; sending = false;
      clearInterval(timer); bridge.stop(); clearQueue(); seen.clear();
    },
    subscribe(type, ...args) {
      if (!running || type !== "comments") return;
      const payload = args[0] as {comments?: unknown} | null;
      if (!Array.isArray(payload?.comments)) return;
      if (!payload.comments.length) return;
      receivedCount += payload.comments.length;
      const now = Date.now();
      for (const [key, expiry] of seen) if (expiry < now) seen.delete(key);
      const connection = syncConnection();
      const initial = connection.connected && initialBatchPending;
      const comments = payload.comments.map(value => ({comment: normalizeComment(value, settings), timestamp: commentTimestamp(value)}));
      // 初回の時刻不明分は受信順の最後だけを読む。それ以前のIDも記録する。
      let latestUnknown = -1;
      if (initial) {
        for (let i = 0; i < comments.length; i++) {
          const {comment, timestamp} = comments[i]!;
          if (comment && timestamp === null && !seen.has(comment.key)) latestUnknown = i;
        }
        initialBatchPending = false;
      }
      for (let i = 0; i < comments.length; i++) {
        const {comment, timestamp} = comments[i]!;
        if (initial && i < latestUnknown && comment?.key === comments[latestUnknown]!.comment?.key) continue;
        if (!comment || seen.has(comment.key)) continue;
        seen.set(comment.key, now + comment.ttl);
        if (seen.size > 5000) seen.delete(seen.keys().next().value!);
        if (!connection.connected || connection.connectedAt === null ||
            (timestamp !== null && timestamp < connection.connectedAt) ||
            (initial && timestamp === null && i !== latestUnknown)) {
          ignoredStartupCount++; continue;
        }
        if (settings.enabled) enqueue(comment.text);
      }
    },
    async request(req) {
      if (req.method === "GET") return {code: 200, response: snapshot()};
      if (req.method !== "POST") return {code: 405, response: {error: "GET/POSTのみ対応しています"}};
      let body: unknown;
      try { body = typeof req.body === "string" || Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString()) : req.body; }
      catch { return {code: 400, response: {error: "JSON形式のリクエストが必要です"}}; }
      if (!body || typeof body !== "object" || Array.isArray(body)) return {code: 400, response: {error: "JSONオブジェクトのリクエストが必要です"}};
      const input = body as Record<string, unknown>;
      if (input.action === "browse") {
        try { return {code: 200, response: {bridgeFile: await pickBridgeFile()}}; }
        catch (error) { return {code: 503, response: {error: (error as Error).message}}; }
      }
      if (input.action === "settings") {
        let next;
        try { next = validateSettings(input.settings); }
        catch (error) { return {code: 400, response: {error: (error as Error).message}}; }
        const reconnect = next.bridgeFile !== settings.bridgeFile;
        const disabling = settings.enabled && !next.enabled;
        try { save(next); } catch { return {code: 500, response: {error: "設定を保存できませんでした"}}; }
        if (disabling || reconnect) clearQueue();
        else {
          expireQueue();
          while (queue.length > settings.queueLimit) {
            if (settings.queueOverflow === "dropOldest") queue.shift(); else queue.pop();
            droppedCount++;
          }
        }
        if (reconnect) bridge.start(settings.bridgeFile);
      } else if (input.action === "connect") {
        if (typeof input.bridgeFile !== "string" || input.bridgeFile.length > 4096) return {code: 400, response: {error: "bridgeFile文字列を指定してください"}};
        settings.bridgeFile = input.bridgeFile.trim(); clearQueue(); bridge.start(settings.bridgeFile);
      } else if (input.action === "test") {
        if (!running || !syncConnection().connected) return {code: 409, response: {error: "マスコットへの接続完了後に試してください"}};
        if (typeof input.text !== "string" || !input.text.trim() || input.text.length > 1000) return {code: 400, response: {error: "テスト文を1〜1000文字で指定してください"}};
        if (!enqueue(Array.from(input.text.trim()).slice(0, settings.maxTextLength).join(""))) return {code: 409, response: {error: "送信待ちが上限に達しています"}};
      } else return {code: 400, response: {error: "操作が不正です"}};
      return {code: 200, response: snapshot()};
    },
  };
}
