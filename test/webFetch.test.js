import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { webFetch } from '../src/webFetch.js';

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/ok') {
      res.statusCode = 200;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.setHeader('x-test', 'ok');
      res.end('hello world');
      return;
    }

    if (url.pathname === '/echo-method') {
      res.statusCode = 200;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end(req.method || '');
      return;
    }

    if (url.pathname === '/redir') {
      res.statusCode = 302;
      res.setHeader('location', '/ok');
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end('redirecting');
      return;
    }

    if (url.pathname === '/redir-rel') {
      res.statusCode = 302;
      res.setHeader('location', 'ok');
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end('redirecting');
      return;
    }

    if (url.pathname === '/redir-loop') {
      res.statusCode = 302;
      res.setHeader('location', '/redir-loop');
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end('looping');
      return;
    }

    if (url.pathname === '/redir-303') {
      res.statusCode = 303;
      res.setHeader('location', '/echo-method');
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end('see other');
      return;
    }

    if (url.pathname === '/redir-307') {
      res.statusCode = 307;
      res.setHeader('location', '/echo-method');
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end('temporary redirect');
      return;
    }

    if (url.pathname === '/big') {
      res.statusCode = 200;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.setHeader('x-test', 'big');
      res.end('a'.repeat(4096));
      return;
    }

    if (url.pathname === '/slow') {
      res.statusCode = 200;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.setHeader('x-test', 'slow');
      setTimeout(() => res.end('late'), 200);
      return;
    }

    res.statusCode = 404;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('not found');
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('failed to bind test server'));
        return;
      }
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${addr.port}`
      });
    });
  });
}

test('webFetch: success', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await webFetch(`${baseUrl}/ok`, { timeoutMs: 2_000, maxBytes: 1024 });
    assert.equal(res.status, 200);
    assert.equal(res.headers['x-test'], 'ok');
    assert.equal(res.bodyText, 'hello world');
    assert.equal(res.truncated, false);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('webFetch: truncation enforces maxBytes hard cap', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await webFetch(`${baseUrl}/big`, { timeoutMs: 2_000, maxBytes: 100 });
    assert.equal(res.status, 200);
    assert.equal(res.headers['x-test'], 'big');
    assert.equal(res.truncated, true);
    assert.equal(res.bodyText.length, 100);
    assert.equal(res.bodyText, 'a'.repeat(100));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('webFetch: rejects non-http URLs', async () => {
  await assert.rejects(
    () => webFetch('file:///etc/passwd', { timeoutMs: 1000, maxBytes: 1000 }),
    /only supports http\/https/i
  );
});

test('webFetch: follows redirects by default', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await webFetch(`${baseUrl}/redir`, { timeoutMs: 2_000, maxBytes: 1024 });
    assert.equal(res.status, 200);
    assert.equal(res.headers['x-test'], 'ok');
    assert.equal(res.bodyText, 'hello world');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('webFetch: can disable redirect following', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await webFetch(`${baseUrl}/redir`, { timeoutMs: 2_000, maxBytes: 1024, followRedirects: false });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/ok');
    assert.equal(res.bodyText, 'redirecting');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('webFetch: resolves relative redirect locations', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await webFetch(`${baseUrl}/redir-rel`, { timeoutMs: 2_000, maxBytes: 1024 });
    assert.equal(res.status, 200);
    assert.equal(res.headers['x-test'], 'ok');
    assert.equal(res.bodyText, 'hello world');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('webFetch: rejects redirect loops', async () => {
  const { server, baseUrl } = await startServer();
  try {
    await assert.rejects(
      () => webFetch(`${baseUrl}/redir-loop`, { timeoutMs: 2_000, maxBytes: 1024 }),
      /too many redirects/i
    );
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('webFetch: switches method to GET on 303', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await webFetch(`${baseUrl}/redir-303`, { timeoutMs: 2_000, maxBytes: 1024, method: 'POST' });
    assert.equal(res.status, 200);
    assert.equal(res.bodyText, 'GET');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('webFetch: preserves method on 307', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await webFetch(`${baseUrl}/redir-307`, { timeoutMs: 2_000, maxBytes: 1024, method: 'POST' });
    assert.equal(res.status, 200);
    assert.equal(res.bodyText, 'POST');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('webFetch: enforces timeout', async () => {
  const { server, baseUrl } = await startServer();
  try {
    await assert.rejects(
      () => webFetch(`${baseUrl}/slow`, { timeoutMs: 50, maxBytes: 1024 }),
      /timed out/i
    );
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
