import { test, expect } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSocketServer } from "ws";
import { MascotBridge } from "./bridge";

async function until(check: () => boolean) {
  const end = Date.now() + 2000;
  while (!check()) {
    if (Date.now() > end) throw new Error("状態遷移がタイムアウトしました");
    await Bun.sleep(5);
  }
}

test("welcome待機・認証・再起動による接続情報更新・停止", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "mascot-bridge-test-"));
  const file = path.join(dir, "bridge.json");
  const bridge = new MascotBridge(20, 500);
  const servers: WebSocketServer[] = [];
  let connections = 0;
  let welcome: (() => void) | undefined;
  const received: unknown[] = [];
  const server = async (token: string, delayed = false) => {
    const wss = new WebSocketServer({host: "127.0.0.1", port: 0,
      verifyClient: (info: {origin: string; req: {url?: string}}) => !info.origin && new URL(info.req.url!, "http://localhost").searchParams.get("token") === token});
    servers.push(wss);
    await new Promise<void>(resolve => wss.on("listening", resolve));
    wss.on("connection", socket => {
      connections++;
      socket.on("message", data => { received.push(JSON.parse(data.toString())); });
      const send = () => socket.send(JSON.stringify({v: 1, type: "welcome", payload: {protocol: 1, app: "live2d-desktop-mascot"}}));
      if (delayed) welcome = send; else send();
    });
    const address = wss.address();
    if (typeof address !== "object" || !address) throw new Error("address missing");
    await writeFile(file, JSON.stringify({v: 1, host: "127.0.0.1", port: address.port, token}));
    return wss;
  };
  try {
    bridge.start(file);
    await until(() => bridge.status().state === "retrying");
    const first = await server("token +/&?", true);
    await until(() => bridge.status().state === "waitingWelcome" && !!welcome);
    expect(bridge.status().connected).toBe(false);
    expect(bridge.status().connectedAt).toBeNull();
    expect(await bridge.say("早すぎる送信")).toBe(false);
    expect(received).toEqual([]);
    welcome!();
    await until(() => bridge.status().connected);
    const firstConnectedAt = bridge.status().connectedAt!;
    const firstConnectionId = bridge.status().connectionId;
    expect(firstConnectedAt).toBeGreaterThan(0);
    await until(() => received.length === 1);
    expect(received[0]).toMatchObject({v: 1, type: "say", payload: {text: "わんコメに接続しました。"}});
    welcome!();
    expect(await bridge.say("読み上げテスト")).toBe(true);
    await until(() => received.length >= 2);
    expect(received).toHaveLength(2);
    expect(bridge.status().connectedAt).toBe(firstConnectedAt);
    expect(bridge.status().connectionId).toBe(firstConnectionId);
    expect(received[1]).toMatchObject({v: 1, type: "say", payload: {text: "読み上げテスト"}});
    const before = connections;
    await server("new-token");
    for (const client of first.clients) client.terminate();
    await until(() => connections > before && bridge.status().connected);
    expect(bridge.status().connectedAt!).toBeGreaterThanOrEqual(firstConnectedAt);
    expect(bridge.status().connectionId).toBe(firstConnectionId + 1);
    await until(() => received.length >= 3);
    expect(received).toHaveLength(3);
    expect(received[2]).toMatchObject({v: 1, type: "say", payload: {text: "わんコメに接続しました。"}});
    expect(JSON.stringify(bridge.status())).not.toContain("new-token");
    bridge.stop();
    await Bun.sleep(80);
    expect(bridge.status().state).toBe("stopped");
    expect(bridge.status().connectedAt).toBeNull();
    expect(connections).toBe(before + 1);
    expect(received).toHaveLength(3);
  } finally {
    bridge.stop();
    for (const wss of servers) {
      for (const client of wss.clients) client.terminate();
      await Promise.race([new Promise<void>(resolve => wss.close(() => resolve())), Bun.sleep(100)]);
    }
    await rm(dir, {recursive: true});
  }
});

test("不正な接続情報を拒否し、読み込み途中の停止後に接続しない", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "mascot-bridge-test-"));
  const file = path.join(dir, "bridge.json");
  const bridge = new MascotBridge(100, 100);
  try {
    for (const data of [null, {v: 2}, {v: 1, host: "example.com", port: 80, token: "secret"},
      {v: 1, host: "127.0.0.1", port: "80", token: "secret"}]) {
      await writeFile(file, JSON.stringify(data));
      bridge.start(file);
      await until(() => bridge.status().state === "retrying");
      expect(bridge.status().connected).toBe(false);
      expect(JSON.stringify(bridge.status())).not.toContain("secret");
      bridge.stop();
    }
    bridge.start(file);
    bridge.stop();
    await Bun.sleep(150);
    expect(bridge.status().state).toBe("stopped");
  } finally { bridge.stop(); await rm(dir, {recursive: true}); }
});

test("welcomeタイムアウトと認証拒否から再試行する", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "mascot-bridge-test-"));
  const file = path.join(dir, "bridge.json");
  let reject = false;
  const server = new WebSocketServer({host: "127.0.0.1", port: 0, verifyClient: () => !reject});
  const bridge = new MascotBridge(200, 50);
  try {
    await new Promise<void>(resolve => server.on("listening", resolve));
    const address = server.address() as {port: number};
    await writeFile(file, JSON.stringify({v: 1, host: "127.0.0.1", port: address.port, token: "never-expose"}));
    bridge.start(file);
    await until(() => bridge.status().state === "waitingWelcome");
    await until(() => bridge.status().state === "retrying");
    expect(bridge.status().error).toContain("welcome");
    reject = true;
    bridge.start(file);
    await until(() => bridge.status().state === "retrying");
    expect(JSON.stringify(bridge.status())).not.toContain("never-expose");
  } finally {
    bridge.stop();
    for (const client of server.clients) client.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(dir, {recursive: true});
  }
});
