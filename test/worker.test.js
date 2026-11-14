// Tests for worker/index.js with an in-memory KV and a fake Stripe. Run: node test/worker.test.js
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import worker from '../worker/index.js';

const kv = new Map();
const ORDERS = {
  async get(k, type) { const e = kv.get(k); if (!e) return null; return type === 'json' ? JSON.parse(e.v) : e.v; },
  async put(k, v, o = {}) { kv.set(k, { v, meta: o.metadata, ttl: o.expirationTtl }); },
  async list({ prefix }) { return { keys: [...kv].filter(([k]) => k.startsWith(prefix)).map(([name, e]) => ({ name, metadata: e.meta })), list_complete: true }; },
};
const env = { ORDERS, STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_test', ADMIN_TOKEN: 'admin-token-long-enough-123' };

// fake Stripe
const sessions = new Map(); let calls = [];
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url, init });
  assert.equal(init.headers.authorization, 'Bearer sk_test_x');
  const u = new URL(url);
  if (u.pathname === '/v1/checkout/sessions' && init.method === 'POST') {
    const p = new URLSearchParams(init.body);
    const id = 'cs_test_' + (sessions.size + 1);
    const s = { id, url: 'https://checkout.stripe.com/c/pay/' + id, status: 'open', payment_status: 'unpaid', params: p };
    sessions.set(id, s); return new Response(JSON.stringify(s), { status: 200 });
  }
  const m = u.pathname.match(/^\/v1\/checkout\/sessions\/(.+)$/);
  if (m) return new Response(JSON.stringify(sessions.get(m[1])), { status: 200 });
  return new Response('{}', { status: 404 });
};

const base = 'https://shop.test';
const call = (path, init = {}) => worker.fetch(new Request(base + path, init), env, {});
const post = (path, body, headers = {}) => call(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const thumb = 'data:image/jpeg;base64,' + Buffer.from('fakejpeg').toString('base64');
let ok = 0; const t = async (name, fn) => { await fn(); ok++; console.log('ok -', name); };

await t('shop info', async () => {
  const j = await (await call('/api/shop')).json();
  assert.equal(j.live, true); assert.equal(j.test, true); assert.equal(j.sizes.length, 3); assert.equal(j.currency, 'EUR');
  assert.deepEqual(j.currencies, ['EUR', 'GBP', 'USD']); assert.equal(j.sizes[1].prices.GBP, 75);
});
await t('currency guessed from country; test product only with ?test', async () => {
  assert.equal((await (await call('/api/shop', { headers: { 'cf-ipcountry': 'GB' } })).json()).currency, 'GBP');
  assert.equal((await (await call('/api/shop', { headers: { 'cf-ipcountry': 'US' } })).json()).currency, 'USD');
  assert.equal((await (await call('/api/shop', { headers: { 'cf-ipcountry': 'PL' } })).json()).currency, 'EUR');
  const j = await (await call('/api/shop?test=1')).json();
  assert.equal(j.sizes.at(-1).id, 'test'); assert.equal(j.sizes.at(-1).prices.EUR, 1);
});
await t('rejects bad orders', async () => {
  assert.equal((await post('/api/order', { size: 'huge', thumb })).status, 400);
  assert.equal((await post('/api/order', { size: '50x50cm', thumb: 'data:image/png;base64,AAAA' })).status, 400);
  assert.equal((await post('/api/order', 'not json')).status, 400);
  assert.equal((await post('/api/order', { size: '50x50cm', thumb: 'data:image/jpeg;base64,' + 'A'.repeat(600000) })).status, 413);
});
let order;
await t('creates order + checkout session with server price', async () => {
  const r = await post('/api/order', { size: '50x50cm', kind: 'artwork', currency: 'GBP', thumb, price: 1, recipe: { mode: 'text' } });
  assert.equal(r.status, 200);
  order = await r.json();
  assert.match(order.ref, /^PM-[2-9A-HJKMNP-Z]{6}$/);
  assert.equal(order.price, 75); assert.equal(order.status, 'awaiting_payment');
  assert.ok(order.key.length > 20); assert.ok(order.url.startsWith('https://checkout.stripe.com/'));
  const p = [...sessions.values()][0].params;
  assert.equal(p.get('line_items[0][price_data][unit_amount]'), '7500');
  assert.equal(p.get('line_items[0][price_data][currency]'), 'gbp');
  assert.equal(p.get('client_reference_id'), order.ref);
  assert.equal(p.get('success_url'), `${base}/?order=${order.ref}&paid=1`);
  assert.equal(p.get('shipping_address_collection[allowed_countries][0]'), 'GB');
  assert.equal(p.get('line_items[0][price_data][product_data][images][0]'), `${base}/api/thumb/${order.ref}.jpg`);
  assert.ok(!JSON.stringify(await ORDERS.get('order:' + order.ref, 'json')).includes(order.key), 'key stored only as a hash');
  assert.equal(kv.get('order:' + order.ref).ttl, 7 * 86400);
});
await t('test order: 1 EUR, marked test', async () => {
  const r = await (await post('/api/order', { size: 'test', currency: 'EUR', thumb })).json();
  assert.equal(r.price, 1); assert.equal(r.currency, 'EUR'); assert.equal(r.test, true);
  const p = [...sessions.values()].at(-1).params;
  assert.equal(p.get('line_items[0][price_data][unit_amount]'), '100'); assert.equal(p.get('line_items[0][price_data][currency]'), 'eur');
  assert.equal(p.get('metadata[test]'), 'yes');
  const u = await (await post('/api/order', { size: '30x30cm', currency: 'USD', thumb })).json();
  assert.equal(u.price, 59);
  const x = await (await post('/api/order', { size: '30x30cm', currency: 'JPY', thumb })).json();
  assert.equal(x.currency, 'EUR'); assert.equal(x.price, 55); // unknown currency falls back to the default
});
await t('thumbnail is served as JPEG', async () => {
  const r = await call(`/api/thumb/${order.ref}.jpg`);
  assert.equal(r.headers.get('content-type'), 'image/jpeg'); assert.equal(Buffer.from(await r.arrayBuffer()).toString(), 'fakejpeg');
});
await t('status needs the order key', async () => {
  assert.equal((await call('/api/order/' + order.ref)).status, 404);
  assert.equal((await call('/api/order/' + order.ref, { headers: { 'x-order-key': 'wrong' } })).status, 404);
  const j = await (await call('/api/order/' + order.ref, { headers: { 'x-order-key': order.key } })).json();
  assert.equal(j.status, 'awaiting_payment'); assert.ok(j.url.startsWith('https://checkout.stripe.com/'));
});
await t('expired session gets a fresh payment link', async () => {
  sessions.get('cs_test_1').status = 'expired';
  const j = await (await call('/api/order/' + order.ref, { headers: { 'x-order-key': order.key } })).json();
  assert.ok(j.url.startsWith('https://checkout.stripe.com/') && j.url !== order.url);
});

const sign = async (body, secret = 'whsec_test', ts = Math.floor(Date.now() / 1000)) => {
  const k = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = Buffer.from(await webcrypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${ts}.${body}`))).toString('hex');
  return `t=${ts},v1=${sig}`;
};
const event = ref => JSON.stringify({ type: 'checkout.session.completed', data: { object: {
  id: 'cs_test_2', client_reference_id: ref, payment_status: 'paid', amount_total: 7500, payment_intent: 'pi_1',
  customer_details: { email: 'buyer@example.com', name: 'Ann' },
  collected_information: { shipping_details: { name: 'Ann', address: { line1: '1 High St', city: 'London', postal_code: 'N1', country: 'GB' } } } } } });

await t('webhook rejects bad or old signatures', async () => {
  const body = event(order.ref);
  assert.equal((await post('/api/stripe/webhook', body, { 'stripe-signature': await sign(body, 'whsec_wrong') })).status, 400);
  assert.equal((await post('/api/stripe/webhook', body, { 'stripe-signature': await sign(body, 'whsec_test', 1000) })).status, 400);
  assert.equal((await post('/api/stripe/webhook', body + ' ', { 'stripe-signature': await sign(body) })).status, 400);
  assert.equal((await ORDERS.get('order:' + order.ref, 'json')).status, 'awaiting_payment');
});
await t('webhook marks paid and keeps images', async () => {
  const body = event(order.ref);
  assert.equal((await post('/api/stripe/webhook', body, { 'stripe-signature': await sign(body) })).status, 200);
  const o = await ORDERS.get('order:' + order.ref, 'json');
  assert.equal(o.status, 'paid'); assert.equal(o.email, 'buyer@example.com'); assert.equal(o.shippingAddress.city, 'London'); assert.equal(o.amountPaid, 75);
  assert.equal(kv.get('order:' + order.ref).ttl, undefined); assert.equal(kv.get('thumb:' + order.ref).ttl, undefined);
  const j = await (await call('/api/order/' + order.ref, { headers: { 'x-order-key': order.key } })).json();
  assert.equal(j.status, 'paid'); assert.equal(j.url, null); assert.equal(j.shippingAddress, undefined);
});
await t('status check marks paid even without the webhook', async () => {
  const r = await (await post('/api/order', { size: '30x30cm', thumb })).json();
  const s = [...sessions.values()].at(-1); s.payment_status = 'paid'; s.status = 'complete'; s.customer_details = { email: 'b@example.com' };
  const j = await (await call('/api/order/' + r.ref, { headers: { 'x-order-key': r.key } })).json();
  assert.equal(j.status, 'paid');
});
await t('admin routes need the token', async () => {
  assert.equal((await call('/api/admin/orders')).status, 401);
  assert.equal((await call('/api/admin/orders', { headers: { authorization: 'Bearer nope' } })).status, 401);
  const auth = { authorization: 'Bearer ' + env.ADMIN_TOKEN };
  const list = await (await call('/api/admin/orders?status=paid', { headers: auth })).json();
  assert.equal(list.orders.length, 2);
  const full = await (await call('/api/admin/order/' + order.ref, { headers: auth })).json();
  assert.equal(full.shippingAddress.line1, '1 High St'); assert.equal(full.keyHash, undefined); assert.ok(full.thumb.startsWith('data:image/jpeg'));
  assert.equal((await post('/api/admin/order/' + order.ref, { status: 'lost' }, auth)).status, 400);
  const u = await (await post('/api/admin/order/' + order.ref, { status: 'shipped', tracking: 'RM123GB' }, auth)).json();
  assert.equal(u.status, 'shipped'); assert.equal(u.tracking, 'RM123GB');
});
await t('payments off without a key', async () => {
  const saved = env.STRIPE_SECRET_KEY; delete env.STRIPE_SECRET_KEY;
  assert.equal((await (await call('/api/shop')).json()).live, false);
  assert.equal((await post('/api/order', { size: '50x50cm', thumb })).status, 503);
  env.STRIPE_SECRET_KEY = saved;
});
await t('non-api paths go to static assets', async () => {
  env.ASSETS = { fetch: () => new Response('page') };
  assert.equal(await (await call('/')).text(), 'page');
});
console.log(`\n${ok} passed`);
