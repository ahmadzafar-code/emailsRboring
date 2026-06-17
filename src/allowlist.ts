/**
 * allowlist.ts — fail-closed tool surface. The allowlist is baked into code
 * (not config) so an edited config file can never open a hole. Anything not
 * listed here is dropped, so a future upstream release that adds a new
 * send-like tool is hidden by default.
 */

export type UpstreamName = "read" | "write";

/** imdinu read/search tools (all read-only, safe). */
export const READ_TOOLS = new Set<string>([
  "list_accounts",
  "list_mailboxes",
  "get_emails",
  "get_email",
  "search",
  "get_email_links",
  "get_email_attachment",
  "get_attachment",
]);

/** sweetrb organize + draft tools. */
export const WRITE_TOOLS = new Set<string>([
  "create-draft",
  "reply-to-message",
  "forward-message",
  "move-message",
  "batch-move-messages",
  "flag-message",
  "unflag-message",
  "batch-flag-messages",
  "batch-unflag-messages",
  "mark-as-read",
  "mark-as-unread",
  "batch-mark-as-read",
  "batch-mark-as-unread",
  "create-mailbox",
  "rename-mailbox",
  "get-unread-count",
  "list-attachments",
]);

/** Gated send (requires confirm:true at the router). */
export const SEND_TOOLS = new Set<string>(["send-email"]);

/** Tools that send when confirm:true, else are forced to a draft. */
export const DRAFT_FORCE = new Set<string>(["reply-to-message", "forward-message"]);

const EXPOSED_WRITE = new Set<string>([...WRITE_TOOLS, ...SEND_TOOLS]);

export interface RawTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  [k: string]: unknown;
}

/** Minimal JSON-Schema shape we touch when injecting the `confirm` param. */
interface JsonSchema {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  [k: string]: unknown;
}

export interface PublicTool {
  name: string;
  description?: string;
  inputSchema: unknown;
  [k: string]: unknown;
}

const SEND_NOTE =
  " [PROXY POLICY: this proxy never auto-sends. Requires confirm=true to send, and you may ONLY set confirm=true after the user has explicitly approved this exact recipient/subject/body in chat. Without confirm it is refused. Mass-send is disabled.]";
const DRAFT_NOTE =
  " [PROXY POLICY: saved as a DRAFT by default. Set confirm=true to send instead — only after the user explicitly approves in chat.]";

/** Forward a tool def: drop outputSchema (so clients don't expect structuredContent),
 *  inject a `confirm` param + policy note on send-capable tools. */
export interface RouteEntry {
  route: UpstreamName;
  original: string; // upstream tool name to forward to
}

/** Public name: service-prefixed snake_case (rubric: discoverability + no cross-server collisions). */
export function publicName(orig: string): string {
  return "mail_" + orig.replace(/-/g, "_");
}

// sweetrb reads that are read-only despite living in the write upstream.
const READONLY_EXTRA = new Set<string>(["get-unread-count", "list-attachments"]);

/** Tool annotations by category. Hints, not security guarantees. */
function annotationsFor(name: string) {
  if (READ_TOOLS.has(name) || READONLY_EXTRA.has(name)) {
    return { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
  }
  if (SEND_TOOLS.has(name) || DRAFT_FORCE.has(name)) {
    // send-email always, reply/forward when confirm:true → can send (irreversible)
    return { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };
  }
  const idempotent = /^(flag-|unflag-|mark-as-|batch-flag|batch-unflag|batch-mark)/.test(name);
  return { readOnlyHint: false, destructiveHint: false, idempotentHint: idempotent, openWorldHint: true };
}

function annotate(t: RawTool): PublicTool {
  const { outputSchema: _drop, ...rest } = t;
  const inputSchema: JsonSchema =
    t.inputSchema && typeof t.inputSchema === "object"
      ? (structuredClone(t.inputSchema) as JsonSchema)
      : { type: "object", properties: {} };
  const props: Record<string, unknown> = (inputSchema.properties ??= {});
  let description = t.description ?? "";

  if (SEND_TOOLS.has(t.name)) {
    props.confirm = {
      type: "boolean",
      description:
        "Must be true to actually send. Only set true AFTER the user explicitly approves this exact message in chat.",
    };
    description += SEND_NOTE;
  } else if (DRAFT_FORCE.has(t.name)) {
    props.confirm = {
      type: "boolean",
      description:
        "If true, SEND instead of saving a draft (only after explicit user approval). Default false = draft.",
    };
    delete props.send; // upstream's raw send flag is not exposed
    description += DRAFT_NOTE;
  }
  return {
    ...rest,
    name: publicName(t.name),
    description,
    inputSchema,
    annotations: annotationsFor(t.name),
  };
}

/** Build the merged public tool list + a name→upstream routing map.
 *  Throws on a name appearing in both upstreams' allowlisted sets. */
export function buildSurface(
  readTools: RawTool[],
  writeTools: RawTool[]
): { tools: PublicTool[]; routeOf: Map<string, RouteEntry> } {
  const tools: PublicTool[] = [];
  const routeOf = new Map<string, RouteEntry>();
  const add = (t: RawTool, route: UpstreamName) => {
    const pub = publicName(t.name);
    if (routeOf.has(pub)) throw new Error(`Duplicate public tool name: ${pub}`);
    routeOf.set(pub, { route, original: t.name });
    tools.push(annotate(t));
  };
  for (const t of readTools) if (READ_TOOLS.has(t.name)) add(t, "read");
  for (const t of writeTools) if (EXPOSED_WRITE.has(t.name)) add(t, "write");
  return { tools, routeOf };
}
