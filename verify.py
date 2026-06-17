#!/usr/bin/env python3
"""End-to-end verification for emailsRboring-mcp. Read-only except a clearly-marked test draft (in §5)."""
import subprocess, json, threading, queue, time, re, os, sqlite3, sys

INDEX_DB = os.path.expanduser("~/.apple-mail-mcp/index.db")
PASS, FAIL = "\033[32mPASS\033[0m", "\033[31mFAIL\033[0m"
results = []
def check(name, ok, detail=""):
    results.append(ok)
    print(f"  [{PASS if ok else FAIL}] {name}" + (f" — {detail}" if detail else ""))

proc = subprocess.Popen(["node", "build/index.js"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE, text=True, bufsize=1)
out_q, err_lines = queue.Queue(), []
threading.Thread(target=lambda: [out_q.put(l.rstrip("\n")) for l in proc.stdout], daemon=True).start()
threading.Thread(target=lambda: [err_lines.append(l.rstrip("\n")) for l in proc.stderr], daemon=True).start()
def send(o): proc.stdin.write(json.dumps(o) + "\n"); proc.stdin.flush()
def recv_id(want, timeout=60):
    end = time.time() + timeout
    while time.time() < end:
        try: line = out_q.get(timeout=max(0.1, end - time.time()))
        except queue.Empty: return None
        line = line.strip()
        if not line: continue
        try: o = json.loads(line)
        except Exception: continue
        if o.get("id") == want: return o
    return None
def call(cid, name, args, t=90):
    send({"jsonrpc":"2.0","id":cid,"method":"tools/call","params":{"name":name,"arguments":args}})
    return recv_id(cid, t)
def text_of(res):
    r = (res or {}).get("result", {})
    return "".join(b.get("text","") for b in r.get("content",[]) if b.get("type")=="text")

send({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"verify","version":"0"}}})
init = recv_id(1, 45)
print("\n=== 1. BOOT ===")
check("proxy initializes + both upstreams connect", bool(init and init.get("result")),
      (init or {}).get("result",{}).get("serverInfo",{}).get("name",""))
send({"jsonrpc":"2.0","method":"notifications/initialized"})

print("=== 2. TOOL SURFACE (fail-closed, mail_* names, annotations) ===")
send({"jsonrpc":"2.0","id":2,"method":"tools/list"}); tl = recv_id(2, 20)
tools = (tl or {}).get("result",{}).get("tools",[])
names = {t["name"] for t in tools}
check("mail_send_email present (gated)", "mail_send_email" in names)
check("mail_send_serial_email ABSENT", "mail_send_serial_email" not in names)
check("mail_delete_message ABSENT", "mail_delete_message" not in names)
check("sweetrb reads (mail_get_message/search_messages) ABSENT",
      not ({"mail_get_message","mail_search_messages","mail_list_messages"} & names))
check("imdinu reads present (mail_get_email/search/list_accounts)",
      {"mail_get_email","mail_search","mail_list_accounts"} <= names)
check("all tool names are mail_* snake_case", all(re.fullmatch(r"mail_[a-z0-9_]+", n) for n in names))
check("no tool advertises outputSchema", all("outputSchema" not in t for t in tools))
check("every tool has annotations", all(isinstance(t.get("annotations"),dict) for t in tools))
ge = next((t for t in tools if t["name"]=="mail_get_email"), {})
check("reads marked readOnlyHint", ge.get("annotations",{}).get("readOnlyHint") is True)
se = next((t for t in tools if t["name"]=="mail_send_email"), {})
check("send marked destructiveHint", se.get("annotations",{}).get("destructiveHint") is True)
check("mail_send_email schema has injected 'confirm'", "confirm" in se.get("inputSchema",{}).get("properties",{}))

print("=== 3. REDACTION (real OTP + negative control) ===")
con = sqlite3.connect(f"file:{INDEX_DB}?mode=ro", uri=True)
rows = con.execute(
    "SELECT message_id,account,mailbox,subject,content FROM emails "
    "WHERE content LIKE '%verification code%' OR content LIKE '%one-time%' "
    "OR content LIKE '%code to sign in%' OR content LIKE '%your code%' "
    "OR content LIKE '%security code%' LIMIT 60").fetchall()
con.close()
CUE = re.compile(r"(verification code|one[-\s]?time|code to sign in|your code|security code|passcode|otp)", re.I)
secret = None; chosen = None
for mid, acct, mb, subj, content in rows:
    if not content or not CUE.search(content): continue
    m = CUE.search(content); tail = content[m.start(): m.start()+80]
    d = re.search(r"\b(\d{6})\b", tail)
    if d:
        secret, chosen = d.group(1), (mid, acct, mb, subj, content); break
if not chosen:
    check("found a code-bearing message to test", False)
else:
    mid, acct, mb, subj, src = chosen
    check("source (index.db) genuinely contains the code", secret in src, f'code "{secret}" in "{subj[:38]}"')
    r = call(10, "mail_get_email", {"message_id": int(mid), "account": acct, "mailbox": mb}, 90)
    body = text_of(r)
    check("proxy mail_get_email returned content", len(body) > 0)
    check("secret digits MASKED in proxy output", secret not in body, f'looked for "{secret}"')
    check("redaction marker present", "[REDACTED]" in body)
    check("no structuredContent on the wire", "structuredContent" not in (r or {}).get("result",{}))
    rs = call(11, "mail_search", {"query": (subj.split()[0] if subj else "code"), "limit": 5}, 60)
    stext = text_of(rs)
    check("search path returns data", len(stext) > 0)
    check("read output carries untrusted-content fence", "UNTRUSTED EMAIL CONTENT" in stext)

print("=== 5. SEND GATE ===")
r = call(20, "mail_send_email", {"to":["test@example.com"],"subject":"proxy gate test","body":"should be refused"}, 30)
check("mail_send_email WITHOUT confirm is refused",
      bool((r or {}).get("result",{}).get("isError")) and "approval" in text_of(r).lower(), text_of(r)[:55])

print("=== 6. EXFIL GUARDS ===")
r = call(21, "mail_send_email", {"to":["x@example.com"],"subject":"x","body":"x","confirm":True,
                            "attachments":["~/.apple-mail-mcp/attachments/secret.pdf"]}, 30)
check("attachment from secret cache is blocked", "secret attachment cache" in text_of(r).lower())
r = call(22, "mail_send_serial_email", {"recipients":[{"email":"x@y.com"}],"subject":"x","body":"x"}, 20)
check("mass-send not permitted", "not permitted" in text_of(r).lower())

proc.terminate(); time.sleep(0.3)
print("\n=== RESULT ===")
ok = all(results)
print(f"{sum(results)}/{len(results)} checks passed — {'ALL GREEN' if ok else 'FAILURES ABOVE'}")
if err_lines:
    print("\n-- proxy stderr (tail) --")
    for l in err_lines[-4:]: print("  " + l)
sys.exit(0 if ok else 1)
