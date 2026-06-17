# Changelog

All notable changes to this project are documented here. Format based on
[Keep a Changelog](https://keepachangelog.com/); this project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-06-16

Initial release.

### Added
- Redacting policy proxy fronting `imdinu/apple-mail-mcp` (read/search) and
  `sweetrb/apple-mail-mcp` (write/organize/send) as one MCP server.
- **26 tools** under a `mail_*` snake_case namespace (8 read, 18 write/send),
  each with safety annotations.
- **Single redaction chokepoint** (`redactToolResult`): strips
  `structuredContent` and masks OTPs / verification codes / passcodes in text.
- **Fail-closed allowlist** — mass/mail-merge send, delete/trash, and mail-rule
  editing are not exposed.
- **Confirm-only send** (`mail_send_email` requires `confirm:true`);
  `reply`/`forward` default to drafts.
- **Untrusted-content fence** on reads and **attachment-exfil block** on sends.
- Optional `sendAllowlist` and `fullBodyDefault` knobs in
  `emailsRboring.config.json`.
- 25,000-character response truncation.
- `verify.py` — 22-check end-to-end verification.
- Docs: `README.md`, `SECURITY.md`, `AGENTS.md`, `evals/`, and a `server.json`
  MCP-registry manifest.

### Security
- Documented known limitations: the confirm gate is not proof against
  prompt-injection, redaction is heuristic, and the search index is a plaintext
  cache of email bodies. See `SECURITY.md`.

[0.1.0]: https://github.com/ahmadzafar-code/emailsRboring/releases/tag/v0.1.0
