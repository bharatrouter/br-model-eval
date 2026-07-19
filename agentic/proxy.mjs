// Logging proxy: capture the EXACT request Claude Code sends, forward to BharatRouter,
// return the response. Point ANTHROPIC_BASE_URL=http://localhost:8791 at it.
import http from 'node:http';
import { appendFileSync, writeFileSync } from 'node:fs';
const TARGET = 'https://api.bharatrouter.com';
const LOG = '/tmp/cc-capture.log';
writeFileSync(LOG, '');
// Four cumulative counters: uncached-input, output, cache-read, cache-creation.
writeFileSync('/tmp/proxy-tokens.txt', '0 0 0 0');
let n = 0, cumIn = 0, cumOut = 0, cumCacheR = 0, cumCacheC = 0;
const HOP = new Set(['host', 'content-length', 'connection', 'accept-encoding']);

http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks).toString();
  n++;
  // save each request body to its own file for easy replay
  if (req.method === 'POST' && body) writeFileSync(`/tmp/cc-req-${n}.json`, body);
  appendFileSync(LOG, `\n===== REQ ${n} ${req.method} ${req.url} =====\nHEADERS: ${JSON.stringify(req.headers)}\nBODYLEN: ${body.length}\n`);
  try {
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k.toLowerCase())) headers[k] = v;
    const up = await fetch(TARGET + req.url, {
      method: req.method,
      headers,
      body: req.method === 'POST' ? body : undefined,
    });
    const buf = Buffer.from(await up.arrayBuffer());
    // Tally real token usage from BR's Anthropic SSE (Claude Code can't surface it for a
    // custom endpoint). Capture all four billable components per response so the harness can
    // price with cache awareness (cache reads bill at 0.1× input; explicit cache writes at
    // 1.25× on the native Anthropic path). Native (Fable) carries input/cache_read/
    // cache_creation in message_start; the translated path (Kimi/Sol) carries uncached
    // input_tokens + cache_read_input_tokens in message_delta once BR surfaces them.
    // Take the last non-null value of each field across the response's events.
    try {
      let inT = 0, outT = 0, cacheR = 0, cacheC = 0;
      for (const line of buf.toString().split('\n')) {
        if (!line.startsWith('data:')) continue;
        try {
          const j = JSON.parse(line.slice(5).trim());
          const u = j.type === 'message_start' ? j.message?.usage : j.usage;
          if (!u) continue;
          if (u.input_tokens != null) inT = u.input_tokens;
          if (u.output_tokens != null) outT = u.output_tokens;
          if (u.cache_read_input_tokens != null) cacheR = u.cache_read_input_tokens;
          if (u.cache_creation_input_tokens != null) cacheC = u.cache_creation_input_tokens;
        } catch {}
      }
      cumIn += inT; cumOut += outT; cumCacheR += cacheR; cumCacheC += cacheC;
      writeFileSync('/tmp/proxy-tokens.txt', `${cumIn} ${cumOut} ${cumCacheR} ${cumCacheC}`);
    } catch {}
    appendFileSync(LOG, `RESP ${up.status} len=${buf.length} body=${buf.toString().slice(0, 300)}\n`);
    const rh = {};
    for (const [k, v] of up.headers) if (k.toLowerCase() !== 'content-encoding') rh[k] = v;
    res.writeHead(up.status, rh);
    res.end(buf);
  } catch (e) {
    appendFileSync(LOG, `PROXY ERR ${e}\n`);
    res.writeHead(502); res.end(String(e));
  }
}).listen(8791, () => console.error('proxy on http://localhost:8791 → ' + TARGET));
