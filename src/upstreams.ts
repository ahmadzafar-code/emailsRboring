/**
 * upstreams.ts — spawn the two upstream Apple Mail MCP servers as stdio children.
 *  - read  = imdinu  (FTS5 read/search), forced read-only
 *  - write = sweetrb (write/organize/send)
 *
 * env MUST spread getDefaultEnvironment() — StdioClientTransport REPLACES the
 * child env if you pass one, so a bare {VAR:...} would strip HOME/PATH and break
 * imdinu (can't find ~/.apple-mail-mcp/index.db or `osascript`).
 */
import fs from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";

// Upstream locations come from the environment (see README).
//  - imdinu defaults to `apple-mail-mcp` on PATH (the pipx/uv install). Set
//    EMAILSRBORING_IMDINU_CMD to a full path if it isn't on PATH (e.g. a venv).
//  - sweetrb's built entry has no sensible default; EMAILSRBORING_SWEETRB_ENTRY
//    is required.
const IMDINU_BIN = process.env.EMAILSRBORING_IMDINU_CMD?.trim() || "apple-mail-mcp";
const SWEETRB_ENTRY = process.env.EMAILSRBORING_SWEETRB_ENTRY?.trim() || "";

export interface Upstreams {
  read: Client;
  write: Client;
  close: () => Promise<void>;
}

export async function startUpstreams(): Promise<Upstreams> {
  if (!SWEETRB_ENTRY || !fs.existsSync(SWEETRB_ENTRY)) {
    throw new Error(
      "Set EMAILSRBORING_SWEETRB_ENTRY to the absolute path of sweetrb's built " +
        "entry (…/apple-mail-mcp/build/index.js). " +
        (SWEETRB_ENTRY ? `Not found: ${SWEETRB_ENTRY}` : "Currently unset.")
    );
  }
  const baseEnv = getDefaultEnvironment(); // HOME, PATH, USER, etc.

  const read = new Client({ name: "emailsRboring-read", version: "0.1.0" });
  const readTransport = new StdioClientTransport({
    command: IMDINU_BIN,
    args: ["serve", "-r"],
    env: { ...baseEnv, APPLE_MAIL_READ_ONLY: "true" },
    stderr: "inherit", // forward imdinu logs to our stderr (stdout is the MCP channel)
  });

  const write = new Client({ name: "emailsRboring-write", version: "0.1.0" });
  const writeTransport = new StdioClientTransport({
    command: "node",
    args: [SWEETRB_ENTRY],
    env: { ...baseEnv },
    stderr: "inherit",
  });

  try {
    await read.connect(readTransport);
  } catch (e) {
    throw new Error(
      `Failed to start read upstream (imdinu '${IMDINU_BIN}'): ${String(e)}. ` +
        "If imdinu isn't on PATH, set EMAILSRBORING_IMDINU_CMD to its full path."
    );
  }
  try {
    await write.connect(writeTransport);
  } catch (e) {
    await read.close().catch(() => {});
    throw new Error(`Failed to start write upstream (sweetrb): ${String(e)}`);
  }

  const close = async () => {
    await Promise.allSettled([read.close(), write.close()]);
  };
  return { read, write, close };
}
