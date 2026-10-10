import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { createSayMessage } from "./protocol";

export type ConnectionState = "stopped" | "connecting" | "waitingWelcome" | "connected" | "retrying";

export function defaultBridgeFile(): string {
  if (process.env.MASCOT_BRIDGE_FILE) return process.env.MASCOT_BRIDGE_FILE;
  const home = homedir();
  const base = process.platform === "win32"
    ? process.env.APPDATA || path.join(home, "AppData", "Roaming")
    : process.platform === "darwin"
      ? path.join(home, "Library", "Application Support")
      : process.env.XDG_CONFIG_HOME || path.join(home, ".config");
  return path.join(base, "Live2D Desktop Mascot", "bridge.json");
}

export class MascotBridge {
  private generation = 0;
  private socket?: WebSocket;
  private timer?: ReturnType<typeof setTimeout>;
  private file = "";
  private state: ConnectionState = "stopped";
  private error: string | null = null;
  private connectedAt: number | null = null;
  private connectionId = 0;

  constructor(private readonly retryMs = 3000, private readonly timeoutMs = 5000) {}

  status() {
    return { state: this.state, connected: this.state === "connected", connectedAt: this.connectedAt,
      connectionId: this.connectionId, bridgeFile: this.file, error: this.error };
  }

  async say(text: string): Promise<boolean> {
    const socket = this.socket;
    if (this.state !== "connected" || socket?.readyState !== WebSocket.OPEN) return false;
    return new Promise(resolve => {
      try {
        socket.send(JSON.stringify(createSayMessage(text)), error => resolve(!error));
      } catch { resolve(false); }
    });
  }

  start(file = "") {
    this.stop();
    this.file = file || defaultBridgeFile();
    void this.connect(this.generation);
  }

  stop() {
    this.generation++;
    clearTimeout(this.timer);
    this.timer = undefined;
    const socket = this.socket;
    this.socket = undefined;
    socket?.terminate();
    this.state = "stopped";
    this.connectedAt = null;
    this.error = null;
  }

  private retry(generation: number, error: string) {
    if (generation !== this.generation) return;
    clearTimeout(this.timer);
    const socket = this.socket;
    this.socket = undefined;
    socket?.terminate();
    this.state = "retrying";
    this.connectedAt = null;
    this.error = error;
    // 毎回ファイルを読み直し、マスコット再起動時のポートとトークン更新に追従する。
    this.timer = setTimeout(() => void this.connect(generation), this.retryMs);
    this.timer.unref();
  }

  private async connect(generation: number) {
    if (generation !== this.generation) return;
    this.state = "connecting";
    let info: unknown;
    try {
      const text = await readFile(this.file, "utf8");
      info = JSON.parse(text);
    } catch {
      this.retry(generation, "bridge.jsonを読み込めません。マスコットの起動とファイルの場所を確認してください。");
      return;
    }
    if (generation !== this.generation) return;
    const value = info as Record<string, unknown> | null;
    if (!value || value.v !== 1 || value.host !== "127.0.0.1" ||
        !Number.isInteger(value.port) || Number(value.port) < 1 || Number(value.port) > 65535 ||
        typeof value.token !== "string" || !value.token.trim()) {
      this.retry(generation, "bridge.jsonの接続情報が不正です（v1・127.0.0.1・有効なport/tokenが必要）。");
      return;
    }
    let socket: WebSocket;
    try {
      socket = new WebSocket(`ws://127.0.0.1:${value.port}/?token=${encodeURIComponent(value.token)}`, {
        handshakeTimeout: this.timeoutMs,
        maxPayload: 64 * 1024,
        // Node用wsを使い、Originを付けない。ネイティブ追加モジュールも使わない。
        perMessageDeflate: false,
      });
    } catch {
      this.retry(generation, "マスコットへの接続を開始できませんでした。");
      return;
    }
    this.socket = socket;
    const current = () => generation === this.generation && this.socket === socket;
    const fail = (message: string) => { if (current()) this.retry(generation, message); };
    this.timer = setTimeout(() => fail("マスコットからwelcomeが届きません。再接続します。"), this.timeoutMs);
    this.timer.unref();
    socket.on("open", () => { if (current()) this.state = "waitingWelcome"; });
    socket.on("message", (data, binary) => {
      if (!current() || binary || this.state === "connected") return;
      let message;
      try { message = JSON.parse(data.toString()); } catch { return; }
      if (message?.type !== "welcome") return;
      if (message.v !== 1 || message.payload?.protocol !== 1 || message.payload?.app !== "live2d-desktop-mascot") {
        fail("マスコットのwelcomeが対応するプロトコルではありません。");
        return;
      }
      clearTimeout(this.timer);
      this.timer = undefined;
      this.state = "connected";
      this.connectedAt = Date.now();
      this.connectionId++;
      this.error = null;
      // 接続成立ごとに1回通知する。重複welcomeは上の接続済み判定で除外する。
      void this.say("わんコメに接続しました。");
    });
    // エラー本文には認証URLが含まれる可能性があるため外へ返さない。
    socket.on("error", () => fail("マスコットへの接続に失敗しました。再接続します。"));
    socket.on("close", () => fail("マスコットとの接続が切れました。再接続します。"));
  }
}
