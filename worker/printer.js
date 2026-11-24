// Print on demand with Gelato (https://www.gelato.com). Paid orders are sent here from the Stripe webhook.
//
// Secret: GELATO_API_KEY (Gelato dashboard → Developer → API keys). Without it, paid orders simply wait for you.
// Settings: SHOP.printer in shop.js (product per size, draft or straight to print, shipping method).
//
// Gelato's API is described from its public OpenAPI description (order.gelatoapis.com/v4/orders, X-API-KEY header).
// Check the first real order in the Gelato dashboard before switching orderType from 'draft' to 'order'.

import { SHOP } from './shop.js';

const GELATO_ORDERS = 'https://order.gelatoapis.com/v4/orders';
const GELATO_PRODUCTS = 'https://product.gelatoapis.com/v3/catalogs';

// Sends one paid order to Gelato, once. Records the outcome on the order as `print`.
export async function sendToPrinter(env, ref, origin, { loadOrder, saveOrder }, force = false) {
  const order = await loadOrder(env, ref);
  if (!order || order.status === 'cancelled' || order.status === 'refunded') return null;
  if (order.print && !force && order.print.status !== 'failed') return order.print; // already sent or being sent
  const done = async print => { order.print = { ...print, at: Date.now() }; await saveOrder(env, order); return order.print; };

  if (order.test) return done({ status: 'skipped', reason: 'Test order: not printed' });
  if (order.status !== 'paid' && !force) return done({ status: 'waiting', reason: 'Not paid' });
  if (!env.GELATO_API_KEY) return done({ status: 'manual', reason: 'No GELATO_API_KEY set: send this order by hand' });
  const productUid = SHOP.printer.products[order.size];
  if (!productUid) return done({ status: 'manual', reason: `No Gelato product set for ${order.size} in worker/shop.js` });
  if (!order.printToken || !order.printBytes) return done({ status: 'failed', reason: 'No print file was uploaded with this order' });
  const a = order.shippingAddress || {};
  if (!a.line1 || !a.country) return done({ status: 'failed', reason: 'No delivery address from Stripe' });

  await done({ status: 'sending' });
  const [firstName, ...rest] = String(order.name || 'Customer').trim().split(/\s+/);
  const body = {
    orderType: SHOP.printer.orderType === 'order' ? 'order' : 'draft',
    orderReferenceId: order.ref,
    customerReferenceId: order.email || order.ref,
    currency: order.currency,
    items: [{
      itemReferenceId: order.ref + '-1',
      productUid,
      files: [{ type: 'default', url: `${origin}/api/print/${order.ref}/${order.printToken}.jpg` }],
      quantity: 1,
    }],
    shippingAddress: {
      firstName, lastName: rest.join(' ') || firstName,
      addressLine1: a.line1, addressLine2: a.line2 || '', city: a.city || '', postCode: a.postal_code || '',
      state: a.state || '', country: a.country, email: order.email || '', phone: order.phone || '',
    },
  };
  if (SHOP.printer.shipmentMethodUid) body.shipmentMethodUid = SHOP.printer.shipmentMethodUid;
  try {
    const r = await fetch(GELATO_ORDERS, { method: 'POST', headers: { 'x-api-key': env.GELATO_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return done({ status: 'failed', reason: `Gelato said ${r.status}: ${String(j.message || j.error || JSON.stringify(j)).slice(0, 300)}` });
    if (order.status === 'paid') order.status = 'printing';
    return done({ status: body.orderType === 'draft' ? 'draft' : 'sent', gelatoId: j.id || null });
  } catch (e) {
    return done({ status: 'failed', reason: 'Could not reach Gelato: ' + String(e && e.message || e).slice(0, 200) });
  }
}

// Gelato's order status webhook (set up in the Gelato dashboard with the URL in the README). It carries no signature,
// so the URL itself holds a secret (GELATO_WEBHOOK_KEY), and only status and tracking are taken from it.
export async function gelatoWebhook(request, env, key, { loadOrder, saveOrder, safeEqual }) {
  if (!env.GELATO_WEBHOOK_KEY || env.GELATO_WEBHOOK_KEY.length < 16 || !safeEqual(key, env.GELATO_WEBHOOK_KEY)) return { status: 404 };
  const e = await request.json().catch(() => null);
  const ref = e && (e.orderReferenceId || (e.order && e.order.orderReferenceId));
  const order = typeof ref === 'string' ? await loadOrder(env, ref) : null;
  if (!order) return { status: 200 }; // not ours, or a test ping
  const fs = String(e.fulfillmentStatus || (e.order && e.order.fulfillmentStatus) || '').toLowerCase();
  const tracks = [];
  for (const it of e.items || []) for (const f of it.fulfillments || []) tracks.push(f.trackingUrl || f.trackingCode);
  const tracking = tracks.find(t => typeof t === 'string' && t);
  if (['shipped', 'in_transit', 'delivered'].includes(fs)) order.status = 'shipped';
  else if (['printed', 'in_production', 'passed', 'created', 'uploading'].includes(fs) && order.status === 'paid') order.status = 'printing';
  else if (['canceled', 'cancelled', 'failed'].includes(fs)) order.note = 'Gelato: ' + fs;
  if (tracking) order.tracking = tracking.slice(0, 300);
  order.print = { ...(order.print || {}), gelatoStatus: fs || null, updated: Date.now() };
  await saveOrder(env, order);
  return { status: 200 };
}

// Admin check: does each size's product id exist at Gelato, and what does it cost to print (before delivery)?
// If an id is unknown, lists similar ids from the posters catalogue to pick from.
export async function gelatoCheck(env, url) {
  if (!env.GELATO_API_KEY) return { error: 'Set GELATO_API_KEY first: npx wrangler secret put GELATO_API_KEY' };
  const country = (url.searchParams.get('country') || 'GB').replace(/[^A-Z]/gi, '').toUpperCase().slice(0, 2);
  const h = { 'x-api-key': env.GELATO_API_KEY };
  const get = async u => { const r = await fetch(u, { headers: h }); return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) }; };
  const out = { country, sizes: {} };
  let catalogue = null;
  for (const [size, uid] of Object.entries(SHOP.printer.products)) {
    const res = { productUid: uid || null };
    if (uid) {
      const p = await get(`https://product.gelatoapis.com/v3/products/${encodeURIComponent(uid)}`);
      res.exists = p.ok; res.status = p.status;
      if (p.ok) {
        const pr = await get(`https://product.gelatoapis.com/v3/products/${encodeURIComponent(uid)}/prices?country=${country}`);
        res.prices = pr.ok ? (Array.isArray(pr.body) ? pr.body.filter(x => x.quantity === 1) : pr.body) : `prices: Gelato said ${pr.status}`;
      }
    }
    if (!res.exists) {
      if (!catalogue) catalogue = (await gelatoProducts(env, new URL('https://x/?catalog=posters'))).productUids || [];
      const tag = `pf_${size.toLowerCase()}_`;
      res.candidates = catalogue.filter(u => u.includes(tag) && /_ver$/.test(u)).slice(0, 30);
    }
    out.sizes[size] = res;
  }
  return out;
}

// Admin helper: find Gelato product ids, e.g. ?catalog=posters&q=300x300
export async function gelatoProducts(env, url) {
  if (!env.GELATO_API_KEY) return { error: 'Set GELATO_API_KEY first' };
  const catalog = (url.searchParams.get('catalog') || 'posters').replace(/[^a-z0-9-]/gi, '');
  const q = (url.searchParams.get('q') || '').toLowerCase();
  const found = [];
  for (let offset = 0; offset < 2000 && found.length < 200; offset += 100) {
    const r = await fetch(`${GELATO_PRODUCTS}/${catalog}/products:search`, {
      method: 'POST', headers: { 'x-api-key': env.GELATO_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ limit: 100, offset }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { error: `Gelato said ${r.status}`, detail: j };
    const list = j.products || [];
    for (const p of list) if (!q || String(p.productUid).toLowerCase().includes(q)) found.push(p.productUid);
    if (list.length < 100) break;
  }
  return { catalog, count: found.length, productUids: found };
}
