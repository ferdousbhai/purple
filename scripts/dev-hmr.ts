const child = Bun.spawn(["electrobun", "dev"], {
  env: {
    ...process.env,
    RIFF_DEV_SERVER_URL: "http://127.0.0.1:5173",
  },
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

process.exit(await child.exited);
