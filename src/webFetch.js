import http from 'node:http';
import https from 'node:https';

function normalizeHeaders(headers) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (value == null) continue;
    if (Array.isArray(value)) out[key.toLowerCase()] = value.join(', ');
    else out[key.toLowerCase()] = String(value);
  }
  return out;
}

function isRedirectStatus(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function coerceUrl(input) {
  if (input instanceof URL) return input;
  return new URL(input);
}

function assertHttpUrl(url) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    const err = new Error(`webFetch only supports http/https URLs (got ${url.protocol})`);
    err.code = 'EURL';
    throw err;
  }
}

function clampPositiveInt(name, value, fallback) {
  if (value == null) return fallback;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0 || Math.floor(num) !== num) {
    const err = new Error(`${name} must be a positive integer`);
    err.code = 'EARGS';
    throw err;
  }
  return num;
}

function normalizeMethod(method) {
  if (method == null) return 'GET';
  if (typeof method !== 'string' || method.trim() === '') {
    const err = new Error('method must be a non-empty string');
    err.code = 'EARGS';
    throw err;
  }
  return method.toUpperCase();
}

/**
 * Fetch a URL over http/https without new dependencies, enforcing hard size + time limits.
 *
 * @param {string|URL} url
 * @param {object} [options]
 * @param {string} [options.method]
 * @param {Record<string, string>} [options.headers]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.maxBytes]
 * @param {boolean} [options.followRedirects]
 * @returns {Promise<{ status: number, headers: Record<string, string>, bodyText: string, truncated: boolean }>}
 */
export async function webFetch(url, options = {}) {
  const {
    method,
    headers = {},
    timeoutMs,
    maxBytes,
    followRedirects
  } = options;

  const resolvedUrl = coerceUrl(url);
  assertHttpUrl(resolvedUrl);

  const normalizedTimeoutMs = clampPositiveInt('timeoutMs', timeoutMs, 30_000);
  const normalizedMaxBytes = clampPositiveInt('maxBytes', maxBytes, 1024 * 1024);
  const normalizedFollowRedirects = followRedirects !== false;
  const normalizedMethod = normalizeMethod(method);

  return fetchOnce(resolvedUrl, {
    method: normalizedMethod,
    headers,
    timeoutMs: normalizedTimeoutMs,
    maxBytes: normalizedMaxBytes,
    followRedirects: normalizedFollowRedirects,
    redirectCount: 0
  });
}

async function fetchOnce(url, opts) {
  const lib = url.protocol === 'https:' ? https : http;
  const maxRedirects = 5;

  return new Promise((resolve, reject) => {
    /** @type {NodeJS.Timeout | null} */
    let timer = null;
    let settled = false;
    let truncated = false;
    /** @type {Error | null} */
    let intentionalAbort = null;
    /** @type {Buffer[]} */
    const chunks = [];
    let bytes = 0;

    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (err) reject(err);
      else resolve(result);
    };

    const req = lib.request(
      url,
      {
        method: opts.method,
        headers: opts.headers
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const responseHeaders = normalizeHeaders(res.headers);

        if (opts.followRedirects && isRedirectStatus(status) && responseHeaders.location) {
          res.resume(); // drain
          if (opts.redirectCount >= maxRedirects) {
            const err = new Error(`too many redirects (>${maxRedirects})`);
            err.code = 'EREDIRECT';
            finish(err);
            return;
          }

          let nextUrl;
          try {
            nextUrl = new URL(responseHeaders.location, url);
            assertHttpUrl(nextUrl);
          } catch (e) {
            const err = new Error(`invalid redirect location: ${responseHeaders.location}`);
            err.code = 'EREDIRECT';
            finish(err);
            return;
          }

          let nextMethod = opts.method;
          // Match common redirect behavior (roughly fetch/curl-like).
          if (status === 303) nextMethod = 'GET';
          if ((status === 301 || status === 302) && opts.method === 'POST') nextMethod = 'GET';

          fetchOnce(nextUrl, {
            ...opts,
            method: nextMethod,
            redirectCount: opts.redirectCount + 1
          }).then(resolve, reject);
          return;
        }

        res.on('data', (chunk) => {
          if (settled) return;
          if (!Buffer.isBuffer(chunk)) chunk = Buffer.from(chunk);

          const remaining = opts.maxBytes - bytes;
          if (remaining <= 0) {
            truncated = true;
            intentionalAbort = new Error('maxBytes exceeded');
            intentionalAbort.code = 'EMAXBYTES';
            res.destroy(intentionalAbort);
            req.destroy(intentionalAbort);
            finish(null, {
              status,
              headers: responseHeaders,
              bodyText: Buffer.concat(chunks, bytes).toString('utf8'),
              truncated: true
            });
            return;
          }

          if (chunk.length > remaining) {
            chunks.push(chunk.subarray(0, remaining));
            bytes += remaining;
            truncated = true;
            intentionalAbort = new Error('maxBytes exceeded');
            intentionalAbort.code = 'EMAXBYTES';
            res.destroy(intentionalAbort);
            req.destroy(intentionalAbort);
            finish(null, {
              status,
              headers: responseHeaders,
              bodyText: Buffer.concat(chunks, bytes).toString('utf8'),
              truncated: true
            });
            return;
          }

          chunks.push(chunk);
          bytes += chunk.length;
        });

        res.on('end', () => {
          if (settled) return;
          finish(null, {
            status,
            headers: responseHeaders,
            bodyText: Buffer.concat(chunks, bytes).toString('utf8'),
            truncated
          });
        });

        res.on('error', (err) => {
          if (settled) return;
          if (intentionalAbort && err && err.code === intentionalAbort.code) return;
          finish(err);
        });
      }
    );

    req.on('error', (err) => {
      if (settled) return;
      if (intentionalAbort && err && err.code === intentionalAbort.code) return;
      finish(err);
    });

    timer = setTimeout(() => {
      if (settled) return;
      const err = new Error(`request timed out after ${opts.timeoutMs}ms`);
      err.code = 'ETIMEDOUT';
      intentionalAbort = err;
      req.destroy(err);
      finish(err);
    }, opts.timeoutMs);

    req.end();
  });
}

