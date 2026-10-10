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
  format: "cjs",
});
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error("Build failed");
  }
  await cp(path.join(root, "static"), outDir, { recursive: true });
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
