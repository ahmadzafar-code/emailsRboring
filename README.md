# emailsRboring-mcp

A **safe, redacting MCP server for Apple Mail** on macOS. It lets an LLM read, search, triage, draft, and (with confirmation) send email — while a single policy layer strips secrets, blocks dangerous actions, and refuses to send without your approval.

It's a thin **proxy** in front of two excellent existing servers, adding the safety layer neither has on its own:

- **[imdinu/apple-mail-mcp](https://github.com/imdinu/apple-mail-mcp)** (Python) — fast FTS5 full-body search over your whole mailbox. *Read/search.*
- **[sweetrb/apple-mail-mcp](https://github.com/sweetrb/apple-mail-mcp)** (TypeScript) — a 40-tool AppleScript write surface. *Draft/organize/send.*

> ⚠️ **Read [SECURITY.md](./SECURITY.md) before using.** This tool can read all your mail and send messages. Its protections are real but heuristic — the confirm-only send gate is **not** proof against prompt-injection, and it keeps a plaintext local cache of your email bodies.

---

## What it does

```
 MCP client (Claude Desktop / Claude Code)
        │  one server: "emailsRboring"
        ▼
 ┌──────────────── emailsRboring-mcp (policy proxy) ─────────────────┐
 │ • fail-closed allowlist (send-serial / delete / rules are hidden)  │
 │ • redaction chokepoint: strips structuredContent, masks OTPs/codes │
 │ • confirm-only send; reply/forward default to drafts               │
 │ • untrusted-content fence on reads; attachment-exfil block         │
 │ • 25k char-limit truncation; per-tool safety annotations           │
 └──────────┬───────────────────────────────────────┬────────────────┘
   read/search │                                     │ write/organize/send
        ▼                                             ▼
   imdinu (serve -r)                            sweetrb (build/index.js)
```

**Tools (26, all `mail_*`):**

- **Read/search (8):** `mail_list_accounts`, `mail_list_mailboxes`, `mail_get_emails`, `mail_get_email`, `mail_search`, `mail_get_email_links`, `mail_get_email_attachment`, `mail_get_attachment`
- **Organize (10):** `mail_move_message`, `mail_batch_move_messages`, `mail_flag_message`, `mail_unflag_message`, `mail_batch_flag_messages`, `mail_batch_unflag_messages`, `mail_mark_as_read`, `mail_mark_as_unread`, `mail_batch_mark_as_read`, `mail_batch_mark_as_unread`
- **Mailboxes/info (5):** `mail_create_mailbox`, `mail_rename_mailbox`, `mail_get_unread_count`, `mail_list_attachments`, (+ reads above)
- **Compose (3):** `mail_create_draft`, `mail_reply_to_message`, `mail_forward_message` *(draft by default)*
- **Send (1, gated):** `mail_send_email` *(requires `confirm: true`)*

**Not exposed (by design):** mass/mail-merge send, delete/trash, and mail-rule editing.

---

## Requirements

- **macOS** with Apple Mail configured and running
- **Node.js ≥ 18**
- **Python ≥ 3.11** (for the imdinu upstream)
- **Full Disk Access** for the process that runs imdinu's indexer (it reads `~/Library/Mail`)
- **Automation permission** (Apple Events → Mail) — granted on first run via a macOS prompt

---

## Install

### 1. The read/search upstream (imdinu)
```bash
pipx install apple-mail-mcp          # or: uv tool install apple-mail-mcp
# Grant Full Disk Access to your terminal/host, then build the index:
apple-mail-mcp index                 # one-time; ~40s for ~40k messages
```

### 2. The write/organize upstream (sweetrb)
```bash
git clone https://github.com/sweetrb/apple-mail-mcp sweetrb-apple-mail
cd sweetrb-apple-mail && npm install && npm run build
# note the absolute path to build/index.js
```

### 3. This proxy
```bash
git clone https://github.com/ahmadzafar-code/emailsRboring.git
cd emailsRboring && npm install && npm run build
```

### 4. Point the proxy at the two upstreams
Set these env vars (the proxy reads them at startup):

| Env var | Value |
|---|---|
| `EMAILSRBORING_IMDINU_CMD` | path to imdinu's `apple-mail-mcp` (e.g. `~/.local/bin/apple-mail-mcp`, or a venv path) |
| `EMAILSRBORING_SWEETRB_ENTRY` | absolute path to sweetrb's `build/index.js` |

### 5. Wire into a client

**Claude Code:**
```bash
claude mcp add emailsRboring -s user \
  --env EMAILSRBORING_IMDINU_CMD=/path/to/apple-mail-mcp \
  --env EMAILSRBORING_SWEETRB_ENTRY=/path/to/sweetrb/build/index.js \
  -- node /path/to/emailsRboring-mcp/build/index.js
```

**Claude Desktop** — add to `~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "emailsRboring": {
      "command": "node",
      "args": ["/path/to/emailsRboring-mcp/build/index.js"],
      "env": {
        "EMAILSRBORING_IMDINU_CMD": "/path/to/apple-mail-mcp",
        "EMAILSRBORING_SWEETRB_ENTRY": "/path/to/sweetrb/build/index.js"
      }
    }
  }
}
```
Restart the client to load it.

---

## Configuration

`emailsRboring.config.json` (next to `build/`) carries optional policy knobs (the tool allowlist and redaction rules are baked into code and **cannot** be loosened by config):

```json
{
  "sendAllowlist": [],
  "fullBodyDefault": false
}
```
- **`sendAllowlist`** — empty = off (send is confirm-only). If non-empty, `mail_send_email` recipients must match an entry (e.g. `"you@work.com"` or `"@work.com"`). Recipients can never be derived from email content. **Strongly recommended** if you enable real sending — see SECURITY.md.

---

## Usage examples

Three worked workflows (what you say → which tools run → what happens):

### 1. Morning triage
> **You:** "What needs my attention in my inbox today?"

The agent calls `mail_get_emails` (`filter: today`), groups senders, and surfaces the few human/actionable items above the newsletter noise. Any verification codes in the listing come back `[REDACTED]`. **Read-only — nothing changes.**

### 2. Find a thread and draft a reply
> **You:** "Find the contract-renewal thread with Dana and draft a reply saying I'll join the call Thursday."

The agent calls `mail_search` (`query: "contract renewal"`, full-body FTS5), `mail_get_email` to read the latest message, then `mail_reply_to_message` **with no `confirm`** → a properly threaded **draft** lands in your Drafts. Nothing is sent; you review and hit send in Mail.

### 3. Bulk organize
> **You:** "Archive everything from the K1 Speed newsletter and flag anything from my advisor."

The agent calls `mail_search` to collect ids, then `mail_batch_move_messages` (→ Archive) and `mail_flag_message`. All reversible; **delete is not available** by design.

### Sending (gated)
> **You:** "Email finance@acme.com the summary." → the agent shows you recipient/subject/body and calls `mail_send_email` **only after you say "send it"** (it sets `confirm: true`). Without your approval, the send is refused.

---

## Verify your install

```bash
node build/index.js   # should print: [emailsRboring] ready — 26 tools (8 read / 18 write)
python3 verify.py     # 22 checks: surface, redaction (with a live code), send-gate, exfil guards
```

---

## Credits & License

- Read/search upstream: **imdinu/apple-mail-mcp** — GPL-3.0. Installed separately; this proxy spawns it as a subprocess and does **not** include or modify its code.
- Write upstream: **sweetrb/apple-mail-mcp** — MIT.
- This proxy: **MIT** (see [LICENSE](./LICENSE)).

Huge thanks to both upstream authors — emailsRboring is just the safety layer on top of their work.
