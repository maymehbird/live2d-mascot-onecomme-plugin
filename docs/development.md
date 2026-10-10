# 開発メモ

## 確認した参照元

- 既存ローカルリポジトリ: `C:\Users\kei\Documents\work\thank-you-card-onecomme-plugin`
  - TypeScript + Bun、CommonJS出力、`subscribe('comments', { comments })`、`request` APIを参考にした。
- [Live2D Desktop Mascot](https://github.com/fixtan/live2d-desktop-mascot)
  - 2026-10-10に取得したcommit: `cb4b60892ab7fcf6aab31bd577262874a51b3397`
  - [README](https://github.com/fixtan/live2d-desktop-mascot/blob/cb4b60892ab7fcf6aab31bd577262874a51b3397/README.md)
  - [bridge.js](https://github.com/fixtan/live2d-desktop-mascot/blob/cb4b60892ab7fcf6aab31bd577262874a51b3397/src/main/bridge.js)
  - [bridge-send.js](https://github.com/fixtan/live2d-desktop-mascot/blob/cb4b60892ab7fcf6aab31bd577262874a51b3397/scripts/bridge-send.js)

## 接続仕様

Windowsでは `%APPDATA%\Live2D Desktop Mascot\bridge.json` を読む。ファイルには `v`, `host`, `port`, `token` があり、起動ごとに更新され、終了時に削除される。

`ws://127.0.0.1:<port>/?token=<URLエンコードしたtoken>` に接続し、`welcome` を受け取ってから送る。

```json
{ "v": 1, "type": "say", "payload": { "text": "コメントありがとう" }, "ts": 1791590000000 }
```

`say` は200文字まで。複数キャラの場合は代表（1番目）が反応する。読み上げ音声の選択はマスコット側の設定に従う。

Originヘッダーがある接続は拒否されるため、ブラウザの設定画面ではなくプラグイン本体のNode環境で送信する。実装では `ws` クライアントを同梱し、ワンコメ実行環境のNodeバージョンに依存するグローバルWebSocketを避ける予定。

## 次の実装

1. 実際のコメントpayloadとわんコメの実行環境・永続化APIを確認する。
2. コメントの本文・表示名・ID・自分のコメント判定を正規化する。HTMLと絵文字、再通知、過去コメントの扱いを決める。
3. bridge.jsonの自動検出とパス指定、接続情報の検証、welcome待機、切断処理、再接続を実装する。トークンは設定画面やログに返さない。
4. テンプレート、フィルタ、文字数制限、重複排除、上限付きキューを追加する。送信間隔は音声完了通知ではないので、マスコット側の話し中の挙動も確認する。
5. 設定APIの検証・永続化と設定画面、接続状態、手動テスト送信を追加する。
6. 模擬WSサーバーでプロトコルを確認し、わんコメとマスコットの実機で受信・再接続・終了処理を確認する。

初期状態では送信無効。準備版の設定値は参照専用で、まだ動作を切り替えない。
