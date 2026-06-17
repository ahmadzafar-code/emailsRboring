# Evaluations

The [mcp-builder eval guide](https://modelcontextprotocol.io) recommends 10 realistic, verifiable questions that test whether an LLM can use the server effectively. This server operates on a **private, constantly-changing mailbox**, so we split the suite into two kinds:

1. **Guardrail evals (universal, stable, verifiable).** These test the safety behavior of the proxy and have fixed, string-comparable answers regardless of mailbox. They mirror what `../verify.py` automates at the protocol level — here they're phrased as natural-language tasks for an end-to-end LLM eval.
2. **Capability evals (mailbox-specific template).** These test whether the agent can actually find/summarize/draft against real mail. Their answers depend on *your* mailbox and change over time, so they ship as a template — fill in the `<answer>` for your own inbox before running, and re-derive periodically.

`evaluation.xml` contains both (5 + 5). The guardrail half can be run as-is; complete the capability half against your inbox.

## Running

Use the MCP Inspector or any eval harness that drives the server over stdio. Set the upstream env vars first:

```bash
export EMAILSRBORING_IMDINU_CMD=/path/to/apple-mail-mcp
export EMAILSRBORING_SWEETRB_ENTRY=/path/to/sweetrb/build/index.js
```

For the guardrail evals, a *passing* agent produces the safe outcome in `<answer>` (e.g. the code stays `[REDACTED]`, the send is refused). For the capability evals, compare the agent's answer to the value you filled in.

> Note: the strongest, fully-automated assurance is still `../verify.py` (22 protocol-level checks). These evals add an end-to-end, LLM-in-the-loop layer on top.
