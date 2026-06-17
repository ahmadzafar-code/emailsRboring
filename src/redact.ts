/**
 * redact.ts — the single security-critical chokepoint.
 *
 * Two jobs:
 *  1. redactToolResult(): strip `structuredContent` entirely (FastMCP returns
 *     secrets in BOTH content[].text AND structuredContent — redacting only text
 *     would leak every code), then redact the remaining content[].text blocks.
 *  2. redactText(): mask OTP / verification codes / one-time passwords / meeting
 *     passcodes / token-bearing URLs.
 *
 * IMPORTANT: imdinu read tools return their result as a JSON string in
 * content[].text, so body newlines arrive ESCAPED ("\n" = backslash+n), not as
 * real newlines. Every rule here tolerates both real and escaped newlines.
 *
 * This is heuristic defense-in-depth, deliberately biased to OVER-mask near
 * secret cues. It is NOT a guarantee — the real control is not surfacing
 * secrets in the first place (summarize / full_body opt-in upstream).
 */

const MASK = "[REDACTED]";

// Cap any single text block so a huge email/broad search can't flood the agent's
// context (mcp-builder best practice). Applied AFTER redaction.
const CHARACTER_LIMIT = 25000;

// Phrases that strongly indicate a one-time secret is nearby.
const STRONG_CUE =
  /(verification code|one[-\s]?time (?:code|pass(?:word|code)|pin)|\botp\b|pass\s?code|security code|access code|confirmation code|login code|auth(?:entication)?\s?code|2fa|two[-\s]?factor|code to (?:sign|log)|your[\s\S]{0,14}?\bcode\b)/i;

// A code value: 4–8 digit run, spaced/hyphenated digit run, or 5–8 char
// alphanumeric token (backup-code style). Always anchored so it sits at the
// END of the surrounding match (lets us drop just the value, keep the label).
const CODE = String.raw`(\d{4,8}|\d[\d\s-]{2,9}\d|[A-Z0-9]{5,8})`;

// Cue immediately followed (within a short gap, across real OR escaped newlines)
// by a code value. The gap is any chars, lazy, capped — anchored to a cue so we
// don't nuke arbitrary numbers elsewhere.
const CUE_THEN_CODE = new RegExp(
  String.raw`\b(?:verification code|security code|one[-\s]?time (?:code|pass(?:word|code)|pin)|otp|pass\s?code|access code|confirmation code|login code|auth(?:entication)?\s?code|your\s?code|use this code|enter (?:the|this) code|code to (?:sign\s?in|log\s?in|finish|confirm|continue|verify)|two[-\s]?factor|2fa)\b` +
    String.raw`[\s\S]{0,30}?\b${CODE}\b`,
  "gi"
);

// Token-bearing URL query params (codes/tokens live in query strings).
const URL_PARAM =
  /\b((?:token|access_token|refresh_token|auth|code|otp|key|secret|password|pwd|sig|signature|jwt|session|sid|t)=)[^&\s"'<>]+/gi;

// Isolated 4–8 digit run not glued to other digits/decimals (used only when a
// STRONG_CUE is present in the text — e.g. cue in subject, code in body).
const ISOLATED_DIGITS = /(?<![\d.\-])\d{4,8}(?![\d.])/g;

/** Mask secrets in a single text blob (may be JSON-serialized with escaped \n). */
export function redactText(input: string): string {
  if (!input) return input;
  let out = input;

  // (1) Google-style codes, e.g. "G-481922".
  out = out.replace(/\bG-\d{5,8}\b/g, MASK);

  // (2) Explicit meeting/login passcodes: "Passcode: aB3xY9", "Password: 9381-22".
  out = out.replace(
    /\b(pass(?:word|code))\b\s*[:#=-]?\s*([A-Za-z0-9][A-Za-z0-9-]{3,15})/gi,
    (_m, label) => `${label}: ${MASK}`
  );

  // (3) Cue-then-code proximity (handles same-line "code is 1234" and
  //     "label:\n\n243142", across real or escaped newlines). The code is the
  //     last thing the regex matched, so drop exactly that suffix.
  out = out.replace(CUE_THEN_CODE, (match, code: string) =>
    match.slice(0, match.length - code.length) + MASK
  );

  // (4) If a strong one-time-secret cue is anywhere in the text, also mask
  //     isolated digit runs (catches cue-in-subject / code-in-body). Biased to
  //     over-mask within OTP messages; leaves ordinary mail untouched.
  if (STRONG_CUE.test(out)) {
    out = out.replace(ISOLATED_DIGITS, MASK);
  }

  // (5) Redact token values inside URLs.
  out = out.replace(URL_PARAM, (_m, prefix) => `${prefix}${MASK}`);

  return out;
}

/** MCP CallTool result shape (only the bits we touch). */
export interface ToolResult {
  content?: Array<{ type?: string; text?: string; [k: string]: unknown }>;
  structuredContent?: unknown;
  [k: string]: unknown;
}

/**
 * Redact a CallTool result in place and return it.
 * Strips structuredContent (council fix #1) and redacts every text block.
 */
export function redactToolResult<T extends ToolResult>(result: T): T {
  if (!result || typeof result !== "object") return result;

  // Strip structuredContent entirely — clients must not prefer an unredacted
  // structured copy. (We also strip outputSchema from advertised tools.)
  if ("structuredContent" in result) delete (result as ToolResult).structuredContent;

  const content = result.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && block.type === "text" && typeof block.text === "string") {
        let t = redactText(block.text);
        if (t.length > CHARACTER_LIMIT) {
          t =
            t.slice(0, CHARACTER_LIMIT) +
            `\n\n…[truncated: response exceeded ${CHARACTER_LIMIT} characters. ` +
            `Narrow your query (a more specific search or smaller limit) to see the rest. ` +
            `Note: truncation may leave JSON output incomplete.]`;
        }
        block.text = t;
      }
    }
  }
  return result;
}
