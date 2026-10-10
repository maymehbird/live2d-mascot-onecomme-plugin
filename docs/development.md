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
2. 実装済み: コメントの本文・表示名・IDを正規化し、接続前時刻のコメントを除外し、初回の時刻不明分は最後の1件だけ選び、新着は受信順に全件キューへ入れる。実サービスの履歴・自己コメントフラグと配列順序は継続確認する。
3. 実装済み: bridge.jsonの自動検出と稼働中のパス指定、接続情報の検証、welcome待機、切断処理、再接続。トークンは設定画面やログに返さない。模擬WSサーバーで検証し、わんコメ内での接続は実機確認が必要。
4. 実装済み: テンプレート、フィルタ、文字数制限、重複排除、上限・待機期限・上限時の破棄方針を設定できるFIFOキュー。送信間隔は音声完了通知ではないので、マスコット側の話し中の挙動も確認する。
5. 実装済み: 設定APIの検証・ファイル保存、設定画面、接続状態、手動テスト送信、Windows標準ファイル選択。
6. 模擬WSサーバーでプロトコルを確認し、わんコメとマスコットの実機で受信・再接続・終了処理を確認する。

初期状態ではコメント送信無効。接続はプラグイン有効化時に開始する。設定は変更時に自動保存する。手動テストは送信無効中も使用できる。

## 2026-10-10 読み上げ実装

接続、接続時刻による除外と初回の時刻不明分の1件フォールバック、本文・表示名の正規化、重複除外、テンプレート、送信間隔、上限・待機期限・上限時の破棄方針を設定できるFIFOキュー、設定保存、手動テスト送信を実装した。Windowsの参照ボタンはPowerShell（STA）から標準OpenFileDialogを開いて絶対パスを取得する。選択したファイルの内容やトークンを画面へ返さない。

模擬サーバーではsayメッセージの受信、再接続、welcome待機、停止を検証した。ビルド済みプラグインをNodeで動かし、起動中の実マスコットへのテスト文1件のWebSocket送信を確認した。発声の聴取、わんコメ内での最新コメント送信、標準ダイアログの表示は実機確認が必要。

接続完了前の時刻が付いたコメントは受信回数に関係なく除外する。未接続中の受信は記録だけ行い、再接続時は送信待ちを破棄して基準時刻を更新する。時刻がない場合、各接続の初回は履歴・自己コメント・重複IDを除いた受信順の最後の1件だけ読む。以降は重複ID・履歴フラグで判定する。時刻不明分の新着・履歴の区別は保証できない。実サービスでの配列順序・履歴フラグ・自己コメントフラグは追加確認が必要。初期コメント送信は無効。
