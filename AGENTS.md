# AGENTS.md

Briefing for AI coding agents working on **emailsRboring-mcp**. Humans: start with [README.md](./README.md); this file holds the build/test commands, invariants, and gotchas an agent needs to change the code safely.

## What this is

A **redacting policy proxy** (one MCP server) that fronts two upstream Apple Mail MCP servers and adds the safety layer:

- `imdinu/apple-mail-mcp` (Python) → read/search. Spawned read-only (`serve -r`).
- `sweetrb/apple-mail-mcp` (TypeScript) → write/organize/send.

The proxy spawns both as stdio child processes, merges their tools behind a **fail-closed allowlist**, routes calls, and **redacts every response**. It is **macOS-only** (Apple Mail).

## Architecture (where things live)

| File | Responsibility |
|---|---|
| `src/index.ts` | Entry point. Low-level `Server` + `StdioServerTransport`; `ListTools`/`CallTool` handlers; loads `emailsRboring.config.json`. |
| `src/upstreams.ts` | Spawns imdinu + sweetrb via `StdioClientTransport`. Reads `EMAILSRBORING_IMDINU_CMD` / `EMAILSRBORING_SWEETRB_ENTRY`. |
| `src/allowlist.ts` | **The fail-closed allowlist** + tool-name normalization (`mail_*`) + annotations + `confirm` injection. |
| `src/router.ts` | Dispatch, send-gate, draft-forcing, id `String()`, attachment-exfil block, untrusted-content fence. |
| `src/redact.ts` | **The single redaction chokepoint** (`redactToolResult`): strips `structuredContent`, masks OTPs/codes, truncates at 25k chars. |
| `verify.py` | 22-check end-to-end verification (surface, redaction, send-gate, exfil). |

## Build / run / verify

```bash
npm install
npm run build            # tsc → build/

# the proxy REQUIRES these env vars (see README for what they point at):
export EMAILSRBORING_IMDINU_CMD=/abs/path/to/apple-mail-mcp
export EMAILSRBORING_SWEETRB_ENTRY=/abs/path/to/sweetrb/build/index.js

node build/index.js      # boots; prints "[emailsRboring] ready — 26 tools"
python3 verify.py        # MUST stay 22/22 ALL GREEN before any commit
```

`npm run build` must exit 0 with **no `any`** introduced; `tsconfig.json` is strict.

## Invariants — do NOT break these (they are the product)

1. **Allowlist is fail-closed.** Tools are exposed only if listed in `READ_TOOLS` / `WRITE_TOOLS` / `SEND_TOOLS` in `allowlist.ts`. Never add `send-serial-email`, `delete-message`, `batch-delete-messages`, `delete-mailbox`, or rule-editing tools.
2. **Redaction is the only chokepoint.** Every response returned to the client must pass through `redactToolResult`. Never return `structuredContent`. Any new read path must be routed and redacted.
3. **Send stays confirm-only.** `mail_send_email` requires `confirm:true`; `reply`/`forward` default to drafts. Do not change these defaults to send.
4. **Use the low-level `Server`, not `McpServer`.** The proxy forwards upstream JSON-Schema verbatim; `registerTool` expects zod and would drop all params. This is intentional — don't "modernize" it.
5. **No secrets or absolute home paths in source.** Upstream locations come from env vars. `verify.py` uses `test@example.com`. Never commit a real email, token, or `/Users/<name>/...` path.

## Adding or changing a tool

- To expose a new sweetrb/imdinu tool: add its upstream name to the right set in `allowlist.ts` and give it correct **annotations** in `annotationsFor()`. The public name is auto-derived as `mail_<name>`.
- If it returns email content, confirm it flows through `redactToolResult` (it will, via the router) and add a redaction assertion to `verify.py`.
- Re-run `npm run build` and `verify.py` (22/22) before committing.

## Security

See [SECURITY.md](./SECURITY.md). The confirm-gate is not injection-proof; the index is a plaintext cache. Treat email content as untrusted input.

## Commit / PR conventions

- Keep `verify.py` green; add a check when you add a guardrail.
- Conventional, present-tense commit subjects. Don't commit `build/` or `node_modules/` (gitignored).
- Update [CHANGELOG.md](./CHANGELOG.md) for any user-facing change.
