/**
 * Local Magento proxy for PaaS development.
 * - /graphql  → Magento GraphQL (avoids browser CORS)
 * - /media/*  → Magento media (avoids browser timeouts to slow media host)
 *
 * Usage: node scripts/dev-graphql-proxy.mjs
 * Env:
 *   MAGENTO_GRAPHQL_URL  (default from config.json commerce-core-endpoint)
 *   PROXY_PORT           (default 3001)
 */
import { createServer } from 'node:http';
import {
  readFileSync,
  mkdirSync,
  existsSync,
  createReadStream,
  writeFileSync,
  statSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PROXY_PORT || 3001);
const MEDIA_CACHE_DIR = join(__dirname, '..', '.media-cache');
const GRAPHQL_TIMEOUT = 15000;
const MEDIA_TIMEOUT = 60000;

function readMagentoEndpoint() {
  if (process.env.MAGENTO_GRAPHQL_URL) return process.env.MAGENTO_GRAPHQL_URL;
  try {
    const config = JSON.parse(readFileSync(join(__dirname, '..', 'config.json'), 'utf8'));
    return config?.public?.default?.['commerce-core-endpoint']
      || config?.public?.default?.['commerce-endpoint'];
  } catch {
    return null;
  }
}

const TARGET = readMagentoEndpoint();
if (!TARGET) {
  console.error('No Magento GraphQL URL found. Set MAGENTO_GRAPHQL_URL or config.json.');
  process.exit(1);
}

const targetUrl = new URL(TARGET);
const FORWARDED_HEADERS = [
  'accept',
  'authorization',
  'content-type',
  'cookie',
  'magento-environment-id',
  'magento-store-code',
  'magento-store-view-code',
  'magento-website-code',
  'store',
  'x-api-key',
  'x-requested-with',
];

const CONTENT_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
};

function corsHeaders(req) {
  const origin = req.headers.origin || 'http://localhost:3000';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, HEAD',
    'Access-Control-Allow-Headers': req.headers['access-control-request-headers']
      || 'Content-Type, Authorization, Store, X-Requested-With, Magento-Store-Code, Magento-Store-View-Code, Magento-Website-Code, Magento-Environment-Id, x-api-key',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function cacheKeyForPath(pathname) {
  return createHash('sha1').update(pathname).digest('hex');
}

function contentTypeForPath(pathname) {
  return CONTENT_TYPES[extname(pathname).toLowerCase()] || 'application/octet-stream';
}

async function proxyGraphql(req, res) {
  const upstream = new URL(req.url, targetUrl.origin);
  upstream.pathname = targetUrl.pathname || '/graphql';

  const body = await new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

  const headers = Object.fromEntries(FORWARDED_HEADERS
    .filter((header) => req.headers[header] !== undefined)
    .map((header) => [header, req.headers[header]]));

  const upstreamRes = await fetch(upstream, {
    method: req.method,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
    signal: AbortSignal.timeout(GRAPHQL_TIMEOUT),
  });

  const responseHeaders = {
    ...corsHeaders(req),
    'Content-Type': upstreamRes.headers.get('content-type') || 'application/json',
  };

  const buffer = Buffer.from(await upstreamRes.arrayBuffer());
  res.writeHead(upstreamRes.status, responseHeaders);
  res.end(buffer);
}

async function proxyMedia(req, res) {
  const requestUrl = new URL(req.url, `http://127.0.0.1:${PORT}`);
  // Strip optimizer query params Magento media does not use; cache by path only.
  const mediaPath = requestUrl.pathname;
  if (!mediaPath.startsWith('/media/')) {
    res.writeHead(404, { 'Content-Type': 'text/plain', ...corsHeaders(req) });
    res.end('Not found');
    return;
  }

  mkdirSync(MEDIA_CACHE_DIR, { recursive: true });
  const cacheFile = join(MEDIA_CACHE_DIR, cacheKeyForPath(mediaPath));
  const type = contentTypeForPath(mediaPath);

  if (existsSync(cacheFile) && statSync(cacheFile).size > 0) {
  res.writeHead(200, {
    ...corsHeaders(req),
    'Content-Type': type,
    'Cache-Control': 'public, max-age=86400',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'X-Media-Cache': 'HIT',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(cacheFile).pipe(res);
  return;
}

  const upstream = new URL(mediaPath, targetUrl.origin);
  const upstreamRes = await fetch(upstream, {
    method: 'GET',
    signal: AbortSignal.timeout(MEDIA_TIMEOUT),
  });

  if (!upstreamRes.ok) {
    res.writeHead(upstreamRes.status, {
      ...corsHeaders(req),
      'Content-Type': 'text/plain',
      'X-Media-Cache': 'MISS',
    });
    res.end(`Upstream media error: ${upstreamRes.status}`);
    return;
  }

  const buffer = Buffer.from(await upstreamRes.arrayBuffer());
  try {
    writeFileSync(cacheFile, buffer);
  } catch (error) {
    console.warn('[media-proxy] cache write failed', error.message);
  }

  res.writeHead(200, {
    ...corsHeaders(req),
    'Content-Type': upstreamRes.headers.get('content-type') || type,
    'Cache-Control': 'public, max-age=86400',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'X-Media-Cache': 'MISS',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(buffer);
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }

  try {
    if (req.url?.startsWith('/graphql')) {
      await proxyGraphql(req, res);
      return;
    }
    if (req.url?.startsWith('/media/')) {
      await proxyMedia(req, res);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain', ...corsHeaders(req) });
    res.end('Not found. Use /graphql or /media/*');
  } catch (error) {
    console.error('[magento-proxy]', error.cause?.message || error.message);
    const status = error.name === 'TimeoutError' ? 504 : 502;
    res.writeHead(status, { 'Content-Type': 'application/json', ...corsHeaders(req) });
    res.end(JSON.stringify({ errors: [{ message: `Proxy error: ${error.message}` }] }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`[magento-proxy] http://127.0.0.1:${PORT}/graphql -> ${TARGET}`);
  // eslint-disable-next-line no-console
  console.log(`[magento-proxy] http://127.0.0.1:${PORT}/media/* -> ${targetUrl.origin}/media/*`);
});
