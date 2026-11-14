// Pop Art Mixer order server, as a Cloudflare Worker.
// It serves the page (static assets) and these routes:
//   GET  /api/shop                  sizes, prices and whether card payment is on
//   POST /api/order                 save an order, open a Stripe Checkout Session, reply {ref, key, url, ...}
//   GET  /api/order/<ref>           order status for the buyer (needs the x-order-key header from the order reply)
//   GET  /api/thumb/<ref>.jpg       order thumbnail (shown on the Stripe payment page)
//   POST /api/stripe/webhook        Stripe events: marks orders paid
//   GET  /api/admin/orders          list orders            (Authorization: Bearer <ADMIN_TOKEN>)
//   GET  /api/admin/order/<ref>     one order, everything  (same)
//   POST /api/admin/order/<ref>     {"status": "printing"} (same)
//
// Secrets (set with `npx wrangler secret put NAME`, never in a file):
//   STRIPE_SECRET_KEY      sk_test_... / sk_live_... or a restricted key rk_... with Checkout Sessions write access
//   STRIPE_WEBHOOK_SECRET  whsec_... from the webhook endpoint in the Stripe Dashboard
//   ADMIN_TOKEN            any long random string, for the /api/admin routes
// Binding: ORDERS (a KV namespace). Optional var: SITE_URL (where buyers return after paying; defaults to this Worker's own address).

import { SHOP } from './shop.js';

const REF_ABC = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const REF_RE = /^PM-[2-9A-HJKMNP-Z]{6}$/;
const STATUSES = ['awaiting_payment', 'paid', 'printing', 'shipped', 'cancelled', 'refunded'];
const MAX_BODY = 512 * 1024;
const enc = new TextEncoder();

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
    if (request.method === 'OPTIONS') return cors(env, request, new Response(null, { status: 204 }));
    try {
      return cors(env, request, await route(request, env, url));
    } catch (e) {
      if (e instanceof Response) return cors(env, request, e);
      console.error(e && e.stack || e);
      return cors(env, request, json({ error: 'server_error' }, 500));
    }
  },
};

async function route(request, env, url) {
  const p = url.pathname, m = request.method;
  let r;
  if (p === '/api/shop' && m === 'GET') return shopInfo(request, env, url);
  if (p === '/api/order' && m === 'POST') return createOrder(request, env, url);
  if ((r = p.match(/^\/api\/order\/(PM-[A-Z0-9]{6})$/)) && m === 'GET') return orderStatus(request, env, url, r[1]);
  if ((r = p.match(/^\/api\/thumb\/(PM-[A-Z0-9]{6})\.jpg$/)) && m === 'GET') return thumb(env, r[1]);
  if (p === '/api/stripe/webhook' && m === 'POST') return webhook(request, env);
  if (p.startsWith('/api/admin/')) {
    await requireAdmin(request, env);
    if (p === '/api/admin/orders' && m === 'GET') return adminList(env, url);
    if ((r = p.match(/^\/api\/admin\/order\/(PM-[A-Z0-9]{6})$/))) {
      if (m === 'GET') return adminGet(env, r[1]);
      if (m === 'POST') return adminUpdate(request, env, r[1]);
    }
  }
  return json({ error: 'not_found' }, 404);
}

// ---------- shop ----------
function shopInfo(request, env, url) {
  const country = (request.cf && request.cf.country) || request.headers.get('cf-ipcountry') || '';
  const guess = SHOP.countryCurrency[country] || SHOP.defaultCurrency;
  const sizes = url.searchParams.has('test') ? [...SHOP.sizes, SHOP.testSize] : SHOP.sizes;
  return json({
    currencies: SHOP.currencies,
    currency: SHOP.currencies.includes(guess) ? guess : SHOP.defaultCurrency,
    sizes: sizes.map(({ id, label, prices }) => ({ id, label, prices })),
    shipping: SHOP.shipping,
    live: !!env.STRIPE_SECRET_KEY,
    test: /^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY || ''),
  }, 200, { 'cache-control': 'no-store' });
}

// ---------- orders ----------
async function createOrder(request, env, url) {
  if (!env.STRIPE_SECRET_KEY) return json({ error: 'payments_off' }, 503);
  const body = await readJson(request);
  const size = [...SHOP.sizes, SHOP.testSize].find(s => s.id === body.size);
  if (!size) return json({ error: 'bad_size' }, 400);
  const currency = SHOP.currencies.includes(body.currency) ? body.currency : SHOP.defaultCurrency;
  const price = size.prices[currency];
  if (typeof price !== 'number') return json({ error: 'bad_currency' }, 400);
  const kind = body.kind === 'wall' ? 'wall' : 'artwork';
  if (!isJpeg(body.thumb, 100000)) return json({ error: 'bad_thumb' }, 400);
  if (body.source != null && !isJpeg(body.source, 200000)) return json({ error: 'bad_source' }, 400);
  const recipe = body.recipe && typeof body.recipe === 'object' ? body.recipe : null;
  if (recipe && JSON.stringify(recipe).length > 30000) return json({ error: 'bad_recipe' }, 400);

  let ref;
  for (let i = 0; i < 5 && !ref; i++) {
    const r = newRef();
    if (!(await env.ORDERS.get('order:' + r))) ref = r;
  }
  if (!ref) return json({ error: 'server_error' }, 500);
  const key = randomKey();
  const order = {
    ref, kind, size: size.id, sizeLabel: size.label, price, currency, test: !!size.test,
    shipping: SHOP.shipping.prices[currency] || 0, status: 'awaiting_payment', keyHash: await sha256(key),
    recipe, at: Date.now(), sessionId: null, email: null, shippingAddress: null, paidAt: null, amountPaid: null,
  };
  const ttl = { expirationTtl: SHOP.unpaidDays * 86400 };
  await env.ORDERS.put('thumb:' + ref, body.thumb, ttl);
  if (body.source) await env.ORDERS.put('source:' + ref, body.source, ttl);
  const session = await newSession(env, url, order);
  order.sessionId = session.id;
  await saveOrder(env, order);
  return json({ ...publicOrder(order), key, url: session.url });
}

async function orderStatus(request, env, url, ref) {
  const order = await loadOrder(env, ref);
  const key = request.headers.get('x-order-key') || '';
  if (!order || !key || !safeEqual(await sha256(key), order.keyHash)) return json({ error: 'not_found' }, 404);
  let payUrl = null;
  if (order.status === 'awaiting_payment' && order.sessionId && env.STRIPE_SECRET_KEY) {
    // Don't wait for the webhook: ask Stripe directly, so the buyer sees "Paid" the moment they come back.
    const s = await stripe(env, 'GET', 'checkout/sessions/' + order.sessionId);
    if (s.payment_status === 'paid' || s.payment_status === 'no_payment_required') await markPaid(env, order, s);
    else if (s.status === 'open') payUrl = s.url;
    else if (s.status === 'expired') { // Checkout links last 24 hours: make a fresh one for a buyer who comes back later
      const fresh = await newSession(env, url, order);
      order.sessionId = fresh.id;
      await saveOrder(env, order);
      payUrl = fresh.url;
    }
  }
  return json({ ...publicOrder(order), url: payUrl }, 200, { 'cache-control': 'no-store' });
}

async function thumb(env, ref) {
  const data = await env.ORDERS.get('thumb:' + ref);
  if (!data) return new Response('Not found', { status: 404 });
  const bin = Uint8Array.from(atob(data.slice(data.indexOf(',') + 1)), c => c.charCodeAt(0));
  return new Response(bin, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=86400' } });
}

function newSession(env, url, order) {
  const site = (env.SITE_URL || url.origin).replace(/\/+$/, '');
  const back = `${site}/?order=${order.ref}`;
  const product = order.test
    ? { name: 'Test order (not printed)', description: `Checks the payment flow · order ${order.ref}` }
    : { name: `${SHOP.productName}, ${order.sizeLabel}`, description: `${order.kind === 'wall' ? 'Wall print' : 'Print'} · order ${order.ref}` };
  if (url.protocol === 'https:') product.images = [`${url.origin}/api/thumb/${order.ref}.jpg`];
  const params = {
    mode: 'payment',
    client_reference_id: order.ref,
    metadata: { ref: order.ref, size: order.size, kind: order.kind, test: order.test ? 'yes' : 'no' },
    payment_intent_data: { metadata: { ref: order.ref } },
    line_items: [{ quantity: 1, price_data: { currency: order.currency.toLowerCase(), unit_amount: minor(order.price), product_data: product } }],
    shipping_address_collection: { allowed_countries: SHOP.countries },
    shipping_options: [{ shipping_rate_data: { type: 'fixed_amount', display_name: SHOP.shipping.label, fixed_amount: { amount: minor(order.shipping || 0), currency: order.currency.toLowerCase() } } }],
    success_url: back + '&paid=1',
    cancel_url: back + '&cancelled=1',
  };
  return stripe(env, 'POST', 'checkout/sessions', params);
}

// ---------- Stripe webhook ----------
async function webhook(request, env) {
  const body = await request.text();
  if (!env.STRIPE_WEBHOOK_SECRET || !(await verifyStripe(body, request.headers.get('stripe-signature') || '', env.STRIPE_WEBHOOK_SECRET)))
    return json({ error: 'bad_signature' }, 400);
  const event = JSON.parse(body);
  const s = event.data && event.data.object;
  const ref = s && (s.client_reference_id || (s.metadata && s.metadata.ref));
  if (ref && REF_RE.test(ref)) {
    const order = await loadOrder(env, ref);
    if (order) {
      if ((event.type === 'checkout.session.completed' && s.payment_status === 'paid') || event.type === 'checkout.session.async_payment_succeeded')
        await markPaid(env, order, s);
      else if (event.type === 'checkout.session.async_payment_failed' && order.status === 'awaiting_payment')
        { order.note = 'Payment failed'; await saveOrder(env, order); }
    }
  }
  return json({ received: true }); // always 200 for events we don't act on, or Stripe keeps retrying
}

async function markPaid(env, order, s) {
  if (order.status !== 'awaiting_payment') return;
  const cd = s.customer_details || {};
  const ship = (s.collected_information && s.collected_information.shipping_details) || s.shipping_details || null;
  Object.assign(order, {
    status: 'paid', paidAt: Date.now(), email: cd.email || null, name: (ship && ship.name) || cd.name || null,
    shippingAddress: (ship && ship.address) || null, amountPaid: typeof s.amount_total === 'number' ? s.amount_total / 100 : null,
    paymentIntent: s.payment_intent || null,
  });
  await saveOrder(env, order);
  // keep the images as long as the paid order: they are what gets printed
  for (const k of ['thumb:', 'source:']) {
    const v = await env.ORDERS.get(k + order.ref);
    if (v) await env.ORDERS.put(k + order.ref, v);
  }
}

// Stripe-Signature: t=<unix time>,v1=<hex HMAC-SHA256 of "t.body">. Rejects events older than 5 minutes.
async function verifyStripe(body, header, secret) {
  let t = 0; const sigs = [];
  for (const part of header.split(',')) {
    const i = part.indexOf('='), k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k === 't') t = +v; else if (k === 'v1') sigs.push(v);
  }
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = hex(await crypto.subtle.sign('HMAC', k, enc.encode(`${t}.${body}`)));
  return sigs.some(v => safeEqual(v, mac));
}

// ---------- admin ----------
async function requireAdmin(request, env) {
  const got = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 20 || !safeEqual(await sha256(got), await sha256(env.ADMIN_TOKEN)))
    throw json({ error: 'unauthorised' }, 401);
}
async function adminList(env, url) {
  const want = url.searchParams.get('status');
  const out = [];
  let cursor;
  do {
    const page = await env.ORDERS.list({ prefix: 'order:', cursor });
    for (const k of page.keys) if (!want || (k.metadata && k.metadata.status === want)) out.push({ ref: k.name.slice(6), ...k.metadata });
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor && out.length < 1000);
  out.sort((a, b) => (b.at || 0) - (a.at || 0));
  return json({ orders: out });
}
async function adminGet(env, ref) {
  const order = await loadOrder(env, ref);
  if (!order) return json({ error: 'not_found' }, 404);
  const { keyHash, ...rest } = order;
  return json({ ...rest, thumb: await env.ORDERS.get('thumb:' + ref), source: await env.ORDERS.get('source:' + ref) });
}
async function adminUpdate(request, env, ref) {
  const order = await loadOrder(env, ref);
  if (!order) return json({ error: 'not_found' }, 404);
  const body = await readJson(request);
  if (body.status != null) {
    if (!STATUSES.includes(body.status)) return json({ error: 'bad_status', allowed: STATUSES }, 400);
    order.status = body.status;
  }
  if (typeof body.note === 'string') order.note = body.note.slice(0, 500);
  if (typeof body.tracking === 'string') order.tracking = body.tracking.slice(0, 200);
  await saveOrder(env, order);
  return json(publicOrder(order));
}

// ---------- storage ----------
async function loadOrder(env, ref) { return REF_RE.test(ref) ? env.ORDERS.get('order:' + ref, 'json') : null; }
function saveOrder(env, order) {
  const opts = { metadata: { status: order.status, size: order.size, price: order.price, currency: order.currency, test: !!order.test, at: order.at, email: order.email } };
  if (order.status === 'awaiting_payment') opts.expirationTtl = SHOP.unpaidDays * 86400;
  return env.ORDERS.put('order:' + order.ref, JSON.stringify(order), opts);
}
// what the buyer's page may see (no address, no key hash)
function publicOrder(o) {
  return { ref: o.ref, kind: o.kind, size: o.size, sizeLabel: o.sizeLabel, test: !!o.test, price: o.price, currency: o.currency, shipping: o.shipping, status: o.status, at: o.at, paidAt: o.paidAt, tracking: o.tracking || null };
}

// ---------- helpers ----------
async function stripe(env, method, path, params) {
  const r = await fetch('https://api.stripe.com/v1/' + path, {
    method,
    headers: { authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, 'content-type': 'application/x-www-form-urlencoded' },
    body: params ? formEncode(params).toString() : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error('Stripe error', r.status, j.error && j.error.message);
    throw json({ error: 'payment_provider', detail: j.error && j.error.message }, 502);
  }
  return j;
}
// Stripe wants nested form fields: line_items[0][price_data][currency]=gbp
function formEncode(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    const name = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') formEncode(v, name, out); else out.append(name, String(v));
  }
  return out;
}
async function readJson(request) {
  const len = +request.headers.get('content-length') || 0;
  if (len > MAX_BODY) throw json({ error: 'too_large' }, 413);
  const text = await request.text();
  if (text.length > MAX_BODY) throw json({ error: 'too_large' }, 413);
  try { const v = JSON.parse(text); if (v && typeof v === 'object') return v; } catch (e) { /* fall through */ }
  throw json({ error: 'bad_json' }, 400);
}
const isJpeg = (s, max) => typeof s === 'string' && s.length <= max && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(s);
const minor = v => Math.round(v * 100);
const newRef = () => 'PM-' + Array.from(crypto.getRandomValues(new Uint8Array(6)), b => REF_ABC[b % REF_ABC.length]).join('');
function randomKey() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const hex = buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
async function sha256(s) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(s))); }
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
}
// Only needed when the page is hosted somewhere else (set ALLOWED_ORIGIN to that site's origin).
function cors(env, request, res) {
  const origin = request.headers.get('origin');
  if (!env.ALLOWED_ORIGIN || origin !== env.ALLOWED_ORIGIN) return res;
  const h = new Headers(res.headers);
  h.set('access-control-allow-origin', origin);
  h.set('access-control-allow-methods', 'GET, POST, OPTIONS');
  h.set('access-control-allow-headers', 'content-type, x-order-key');
  h.set('vary', 'origin');
  return new Response(res.body, { status: res.status, headers: h });
}
