import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import toml from "./netlify-tools/node_modules/@iarna/toml/toml.js";
import { zipFunction } from "./netlify-tools/node_modules/@netlify/zip-it-and-ship-it/dist/main.js";

const project = resolve(process.argv[2] || ".ticket-bundle-check/project");
const destination = resolve(process.argv[3] || ".ticket-bundle-check/archives");
const netlify = toml.parse(await readFile(resolve(project, "netlify.toml"), "utf8"));
await mkdir(destination, { recursive: true });
const names = ["support-ticket-action", "support-ticket-followups"];
for (const name of names) {
  const config = netlify.functions[name];
  const archive = await zipFunction(resolve(project, "netlify/functions", name + ".mjs"), destination, {
    archiveFormat: "zip",
    cwd: project,
    basePath: project,
    config: { [name]: {
      nodeBundler: config.node_bundler,
      externalNodeModules: config.external_node_modules,
      nodeVersion: netlify.build.environment.NODE_VERSION + ".x",
    } },
  });
  assert.equal(archive.runtimeAPIVersion, 2);
  assert.equal(archive.bundler, "esbuild");
  assert.equal(archive.runtimeVersion, "nodejs22.x");
  console.log(name, archive.runtimeVersion, archive.path, archive.size);
}

