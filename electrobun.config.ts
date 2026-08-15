import type { ElectrobunConfig } from "electrobun";
import packageJson from "./package.json" with { type: "json" };

export default {
  app: {
    name: "riff",
    identifier: "dev.ferdous.riff",
    version: packageJson.version,
  },
  build: {
    copy: {
      "dist/index.html": "views/mainview/index.html",
      "dist/assets": "views/mainview/assets",
    },
    watchIgnore: ["dist/**"],
    linux: {
      bundleCEF: false,
    },
  },
} satisfies ElectrobunConfig;
