import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const requireFromWeb = createRequire(join(projectRoot, "apps", "web", "package.json"));
const { chromium } = requireFromWeb("playwright");
const assetsDirectory = join(projectRoot, "apps", "web", "dist", "assets");
const workletName = (await readdir(assetsDirectory)).find(
  (name) => name.startsWith("superdough-worklets-") && name.endsWith(".js"),
);
if (!workletName) throw new Error("The built superdough worklet asset is missing.");

const worklet = await readFile(join(assetsDirectory, workletName));
const headerRules = await readFile(
  join(projectRoot, "apps", "web", "public", "_headers"),
  "utf8",
);
const csp = headerRules.match(/Content-Security-Policy: ([^\n]+)/)?.[1];
if (!csp) throw new Error("The hosted Content-Security-Policy is missing.");

const server = createServer((request, response) => {
  response.setHeader("Content-Security-Policy", csp);
  if (request.url === "/worklet.js") {
    response.setHeader("Content-Type", "text/javascript; charset=utf-8");
    response.end(worklet);
    return;
  }
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end("<!doctype html><title>Purple AudioWorklet CSP smoke</title>");
});

let browser;
try {
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || !address.port) throw new Error("The CSP smoke server did not start.");

  const browserArguments = [
    "--headless",
    "--remote-debugging-pipe",
    "--no-startup-window",
    "--disable-background-networking",
    "--disable-gpu",
  ];
  if (process.getuid?.() === 0 || process.env.CI === "true") {
    browserArguments.unshift("--no-sandbox", "--disable-dev-shm-usage");
  }
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_BIN ?? "/usr/bin/chromium",
    headless: true,
    ignoreDefaultArgs: true,
    args: browserArguments,
  });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "load" });
  const result = await page.evaluate(async () => {
    const context = new AudioContext();
    try {
      await context.audioWorklet.addModule("/worklet.js");
      return { ok: true };
    } finally {
      await context.close();
    }
  });
  if (result.ok !== true) {
    throw new Error(`AudioWorklet CSP smoke failed: ${JSON.stringify(result)}`);
  }
  console.log("AudioWorklet loaded under the production CSP.");
} finally {
  await browser?.close();
  if (server.listening) {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}
