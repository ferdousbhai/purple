import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const assetsDirectory = join(projectRoot, "dist", "assets");
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

const profileDirectory = await mkdtemp(join(tmpdir(), "purple-csp-smoke-"));
let browser;
try {
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || !address.port) throw new Error("The CSP smoke server did not start.");

  const debugPort = 9223;
  const browserArguments = [
    "--headless=new",
    "--disable-gpu",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDirectory}`,
    `http://127.0.0.1:${address.port}/`,
  ];
  if (process.getuid?.() === 0) browserArguments.unshift("--no-sandbox");
  browser = spawn(process.env.CHROMIUM_BIN ?? "chromium", browserArguments, {
    stdio: "ignore",
  });

  const page = await findPage(
    debugPort,
    `http://127.0.0.1:${address.port}/`,
  );
  await wait(500);
  const result = await evaluate(
    page.webSocketDebuggerUrl,
    `(async () => {
      const context = new AudioContext();
      try {
        await context.audioWorklet.addModule("/worklet.js");
        return { ok: true };
      } finally {
        await context.close();
      }
    })()`,
  );
  if (result?.result?.result?.value?.ok !== true) {
    throw new Error(`AudioWorklet CSP smoke failed: ${JSON.stringify(result)}`);
  }
  console.log("AudioWorklet loaded under the production CSP.");
} finally {
  if (browser && browser.exitCode === null) {
    const exited = new Promise((resolveExit) => browser.once("exit", resolveExit));
    browser.kill("SIGTERM");
    await Promise.race([exited, wait(3_000)]);
  }
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(profileDirectory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}

async function findPage(debugPort, expectedUrl) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find(
          (target) => target.type === "page" && target.url === expectedUrl,
        );
        if (page?.webSocketDebuggerUrl) return page;
      }
    } catch {
      // Chromium's debugging endpoint is not listening yet.
    }
    await wait(100);
  }
  throw new Error("Chromium did not expose a page for the CSP smoke test.");
}

async function evaluate(webSocketUrl, expression) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", rejectOpen, { once: true });
  });
  const id = 1;
  socket.send(
    JSON.stringify({
      id,
      method: "Runtime.evaluate",
      params: { expression, awaitPromise: true, returnByValue: true },
    }),
  );
  const result = await new Promise((resolveMessage, rejectMessage) => {
    const timeout = setTimeout(
      () => rejectMessage(new Error("Chromium CSP smoke timed out.")),
      15_000,
    );
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      clearTimeout(timeout);
      resolveMessage(message);
    });
  });
  socket.close();
  return result;
}
