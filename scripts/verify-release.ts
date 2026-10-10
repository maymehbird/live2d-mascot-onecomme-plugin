import { createRequire } from "node:module";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const metadata = await Bun.file(path.join(root, "package.json")).json();
const require = createRequire(path.join(root, "package.json"));
const plugin = require(path.join(root, "dist", metadata.name, "plugin.js"));
if (metadata.version !== plugin.version) throw new Error("package.jsonとプラグインのバージョンが一致しません");
if (metadata.license !== "MIT") throw new Error("リリースのライセンスがMITではありません");
if (process.env.GITHUB_EVENT_NAME === "push" && process.env.GITHUB_REF_TYPE === "tag" &&
    process.env.GITHUB_REF_NAME !== `v${metadata.version}`) {
  throw new Error(`タグはv${metadata.version}である必要があります`);
}
const expected = ["plugin.js", "index.html", "README.md", "LICENSE", "THIRD-PARTY-NOTICES.txt"];
for (const file of expected) {
  if (!(await Bun.file(path.join(root, "dist", metadata.name, file)).exists())) throw new Error(`配布ファイルがありません: ${file}`);
}
console.info(`Release files verified: ${metadata.name} v${metadata.version}`);
