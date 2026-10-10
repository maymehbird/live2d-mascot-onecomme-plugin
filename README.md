# Live2Dマスコット連携わんコメプラグイン

わんコメのコメントをWebSocketでLive2D Desktop Mascotへ送り、マスコットに読み上げてもらうためのプロジェクトです。

現在は **開発準備段階**。プラグインの入口、コメント受信件数の参照、設定型と初期値、bridge v1のメッセージ生成、ビルド環境を用意しました。WebSocket接続・送信、コメント正規化、設定編集・保存はまだ実装していません。

## 開発

Bun 1.3以上を使用します。

```sh
bun install
bun run typecheck
bun run build
bun run dev
```

`dist/live2d-mascot-onecomme-plugin/` にCommonJS形式の `plugin.js` と画面を出力します。
動作確認時は、このフォルダを `%APPDATA%\onecomme\plugins\` にコピーし、わんコメで有効化してください。自動配置は行いません。

## 構成

```text
src/index.ts      CommonJSエントリポイント
src/plugin.ts     わんコメのライフサイクル・コメント受信入口
src/settings.ts   設定項目案・初期値
src/protocol.ts   マスコットのsayメッセージ生成
src/types.ts      プラグイン境界の最小型
static/           状態参照画面
scripts/          ビルド処理
docs/             接続仕様・次の実装範囲
```

## カスタマイズ予定

送信の有効化、bridge.jsonの場所、読み上げテンプレート（`{name}` / `{comment}`）、文字数上限、送信間隔、待機件数上限、自分のコメントの除外を設定できる構成にします。設定UIと永続化は次の実装で追加します。

参照元・接続仕様・未実装事項は [docs/development.md](docs/development.md) を参照してください。
