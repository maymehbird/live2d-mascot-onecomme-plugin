import { cp, mkdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const outDir = path.join(root, "dist", "live2d-mascot-onecomme-plugin");
async function build() {
  await mkdir(outDir, { recursive: true });
  const result = await Bun.build({
  entrypoints: [path.join(root, "src", "index.ts")],
  outdir: outDir,
  naming: "plugin.js",
  target: "node",
  define: { "process.env.WS_NO_BUFFER_UTIL": '"1"', "process.env.WS_NO_UTF_8_VALIDATE": '"1"' },
  format: "cjs",
});
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error("Build failed");
  }
  await cp(path.join(root, "static"), outDir, { recursive: true });
  for (const file of ["README.md", "LICENSE"]) await cp(path.join(root, file), path.join(outDir, file));
  const wsLicense = await Bun.file(path.join(root, "node_modules", "ws", "LICENSE")).text();
  await Bun.write(path.join(outDir, "THIRD-PARTY-NOTICES.txt"),
    "This plugin bundles ws (https://github.com/websockets/ws).\n\n" + wsLicense);
  console.info(`Built: ${outDir}`);
}

await build();
if (Bun.argv.includes("--watch")) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = Promise.resolve();
  const rebuild = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      pending = pending.then(build).catch((error) => console.error(error));
    }, 100);
  };
  for (const dir of ["src", "static"]) watch(path.join(root, dir), { recursive: true }, rebuild);
  console.info("Watching src/ and static/...");
}
import { watch } from "node:fs";
