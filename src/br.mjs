// BR client. One endpoint (POST /v1/chat/completions), Bearer br- key. Streams so we can
// measure TTFT, and captures the realized route from response headers (x-br-provider) —
// which matters because BR may fail over mid-run and we must never blend providers silently.
//
// Returns a rich record per call: content, usage tokens, TTFT, total latency, realized
// provider/model, whether the model emitted hidden reasoning tokens, and any error.

const API = process.env.BR_API ?? 'https://api.bharatrouter.com';
const KEY = process.env.BR_API_KEY;
if (!KEY) { console.error('FATAL: set BR_API_KEY (see .env.example)'); process.exit(1); }
// Per-call wall-clock timeout. Reasoning models can think >5 min on hard AIME problems, so
// this must be generous or timeouts masquerade as wrong answers. Override with BR_TIMEOUT_MS.
const TIMEOUT_MS = Number(process.env.BR_TIMEOUT_MS ?? 300_000);

export async function call(model, prompt, { maxTokens = 2048, temperature = null, system = null } = {}) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });

  // These are reasoning models with fixed/forbidden temperature (Fable deprecates it,
  // Kimi forces 1). Omit temperature unless a caller explicitly sets it — natural default
  // sampling gives the variation pass@k needs.
  const body = { model, stream: true, stream_options: { include_usage: true }, max_tokens: maxTokens, messages };
  if (temperature != null) body.temperature = temperature;

  let t0 = performance.now();
  let ttft = null, usage = null, err = null, content = '', reasoned = false, finishReason = null;
  let provider = null, servedModel = null, brLatency = null, status = null;

  // Retry transient failures (network blips, 429, 5xx) — NOT deterministic 4xx (billing,
  // bad-request), which would just fail again. Up to 3 attempts with backoff.
  const isTransient = (e, st) => /fetch failed|timeout|aborted|ECONN|network|socket/i.test(e)
    || st === 429 || (st >= 500 && st < 600);
  for (let attempt = 0; attempt < 3; attempt++) {
    t0 = performance.now();
    ttft = null; usage = null; err = null; content = ''; reasoned = false; finishReason = null;
    provider = null; servedModel = null; brLatency = null; status = null;
    try {
    const res = await fetch(`${API}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${KEY}`,
        'content-type': 'application/json',
        'user-agent': 'br-model-eval/1.0',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    status = res.status;
    provider = res.headers.get('x-br-provider');
    servedModel = res.headers.get('x-br-model');
    brLatency = Number(res.headers.get('x-br-latency-ms')) || null;
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 240)}`);

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) > -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
        let chunk;
        try { chunk = JSON.parse(line.slice(6)); } catch { continue; }
        const d = chunk.choices?.[0]?.delta;
        if (chunk.choices?.[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason;
        if (d?.reasoning_content || d?.reasoning) reasoned = true;
        if (ttft === null && (d?.content || d?.reasoning_content || d?.reasoning)) {
          ttft = performance.now() - t0;
        }
        if (d?.content) content += d.content;
        if (chunk.usage) usage = chunk.usage;
      }
    }
    } catch (e) {
      err = String(e.message ?? e).slice(0, 300);
    }
    if (!err) break;                                   // success
    if (!isTransient(err, status) || attempt === 2) break;  // don't retry deterministic errors
    await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
  }
  const totalMs = Math.round(performance.now() - t0);
  const outTok = usage?.completion_tokens ?? 0;
  const reasoningTok = usage?.completion_tokens_details?.reasoning_tokens ?? 0;
  return {
    model, provider, servedModel, status, err,
    content,
    inTok: usage?.prompt_tokens ?? 0,
    outTok,
    reasoningTok,
    reasoned: reasoned || reasoningTok > 0,
    ttftMs: ttft && Math.round(ttft),
    totalMs,
    brLatencyMs: brLatency,
    finishReason,
    decodeTokPerSec: outTok && ttft ? +(outTok / ((totalMs - ttft) / 1000)).toFixed(1) : 0,
    // classify failure modes for the reliability metric
    failure: classifyFailure(err, content, finishReason),
  };
}

function classifyFailure(err, content, finishReason) {
  if (err) {
    if (/quota|credit|balance|402|429|insufficient/i.test(err)) return 'billing';
    if (/timeout|aborted/i.test(err)) return 'timeout';
    if (/HTTP 4\d\d/.test(err)) return 'client_error';
    if (/HTTP 5\d\d/.test(err)) return 'server_error';
    return 'error';
  }
  if (finishReason === 'content_filter') return 'content_filter';
  if (finishReason === 'length' && (!content || !content.trim())) return 'truncated';
  if (!content || !content.trim()) return 'empty';
  return null; // ok
}
