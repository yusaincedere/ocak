import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { FastifyInstance } from 'fastify';

// A fake picture API: JSON with a random image URL, and the images themselves.
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201e2b1d80e0000000049454e44ae426082', 'hex');
const hits: Record<string, number> = {};
let fake: Server;
let base = '';

let app: FastifyInstance;
let avatars: typeof import('../src/routes/avatars.js');

before(async () => {
  fake = createServer((req, res) => {
    hits[req.url!] = (hits[req.url!] ?? 0) + 1;
    if (req.url === '/male') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ url: `${base}/img/m1.png`, dimensions: { width: 1094, height: 1825 } }));
    }
    if (req.url === '/female') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ results: [{ artist: 'x', image_url: `${base}/img/f1.png` }] }));
    }
    if (req.url?.startsWith('/img/')) {
      res.setHeader('content-type', 'image/png');
      return res.end(PNG);
    }
    if (req.url === '/evil.svg') {
      res.setHeader('content-type', 'image/svg+xml');
      return res.end('<svg onload="alert(1)"/>');
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((ok) => fake.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;

  process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'ocak-test-')), 'test.db');
  process.env.WEB_DIST = '/nonexistent';
  process.env.NODE_ENV = 'test';
  process.env.AVATAR_API_MALE = `${base}/male`;
  process.env.AVATAR_API_FEMALE = `${base}/female`;
  const { buildApp } = await import('../src/app.js');
  avatars = await import('../src/routes/avatars.js');
  app = await buildApp({ logger: false, rateLimits: false });
});
after(async () => {
  await app.close();
  fake.close();
});

const random = (gender: string) => app.inject({ method: 'POST', url: '/api/avatars/random', payload: { gender } });

describe('profile pictures', () => {
  test('the server says which genders it has pictures for', async () => {
    const res = await app.inject('/api/config');
    assert.deepEqual(res.json().avatarGenders, ['male', 'female']);
  });

  test('hands out a same-origin picture with the size the API reported', async () => {
    const res = await random('male');
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.match(body.src, /^\/api\/avatars\/[\w-]+\.[\w-]+$/);
    assert.equal(body.width, 1094);
    assert.equal(body.height, 1825);
  });

  test('finds the image in nested responses too', async () => {
    const res = await random('female');
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().width, null);
  });

  test('serves the picture through the server, and caches it', async () => {
    const { src } = (await random('male')).json();
    const before = hits['/img/m1.png'] ?? 0;
    for (let i = 0; i < 3; i++) {
      const img = await app.inject(src);
      assert.equal(img.statusCode, 200);
      assert.equal(img.headers['content-type'], 'image/png');
      assert.match(String(img.headers['cache-control']), /immutable/);
      assert.deepEqual(img.rawPayload, PNG);
    }
    assert.ok((hits['/img/m1.png'] ?? 0) - before <= 1, 'fetched from the picture site at most once');
  });

  test('serves pictures with long URLs (real picture sites use long file names)', async () => {
    const url = `${base}/img/api/v2/husbando/185d43f1-52ed-400d-8afe-2e66864dfda8-${'x'.repeat(300)}.png`;
    const res = await app.inject(`/api/avatars/${avatars.avatarToken(url)}`);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.rawPayload, PNG);
  });

  test('only fetches URLs this server signed', async () => {
    const forged = `/api/avatars/${Buffer.from('https://tracker.example/pixel.png').toString('base64url')}.AAAAAAAAAAAAAAAAAAAAAA`;
    for (const url of [forged, '/api/avatars/nonsense', '/api/avatars/a.b.c']) {
      assert.equal((await app.inject(url)).statusCode, 404, url);
    }
  });

  test('refuses images that are not plain pictures', async () => {
    const res = await app.inject(`/api/avatars/${avatars.avatarToken(`${base}/evil.svg`)}`);
    assert.equal(res.statusCode, 502);
  });

  test('rejects unknown genders', async () => {
    assert.equal((await random('robot')).statusCode, 400);
  });
});

describe('findImage', () => {
  test('understands common response shapes', () => {
    const { findImage } = avatars;
    assert.deepEqual(findImage({ url: 'https://a.example/1.png', dimensions: { width: 10, height: 20 } }), {
      url: 'https://a.example/1.png',
      width: 10,
      height: 20,
    });
    assert.equal(findImage({ results: [{ url: 'https://a.example/2.webp' }] })?.url, 'https://a.example/2.webp');
    assert.equal(findImage([{ file_url: 'https://a.example/3.jpg', width: 5, height: 6 }])?.width, 5);
    assert.equal(findImage({ images: [{ image: { url: 'https://a.example/4.png' } }] })?.url, 'https://a.example/4.png');
    assert.equal(findImage({ url: 'not a url' }), null);
    assert.equal(findImage({ data: 'nothing here' }), null);
  });
});
