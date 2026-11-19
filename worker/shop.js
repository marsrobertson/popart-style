// Shop settings used by the order server. These prices are what Stripe charges: the page shows them,
// but a price sent by the browser is never trusted. Prices are in major units (55 = €55.00).
// Placeholders: set your own before going live.
export const SHOP = {
  currencies: ['EUR', 'GBP', 'USD'],
  defaultCurrency: 'EUR',
  productName: 'Pop Art Mixer print',
  // Standard poster paper, w × h in cm. The print fills the sheet edge to edge: each tile stretches to the paper's
  // shape with its design centred, and the print file is made at exactly this size.
  sizes: [
    { id: 'A3', label: 'A3 · 29.7×42 cm', w: 29.7, h: 42, prices: { EUR: 39, GBP: 35, USD: 45 } },
    { id: 'A2', label: 'A2 · 42×59.4 cm', w: 42, h: 59.4, prices: { EUR: 59, GBP: 52, USD: 65 } },
  ],
  // A real €1 / £1 / $1 payment for testing the whole flow in live mode. Hidden: it only appears on the private link
  // /?test=<TEST_KEY> (TEST_KEY is a Worker secret). Orders for it are marked test: true and are not printed.
  testSize: { id: 'test', label: 'Test order', w: 29.7, h: 42, prices: { EUR: 1, GBP: 1, USD: 1 }, test: true },
  // One flat delivery rate shown at checkout. 0 = free delivery.
  shipping: { label: 'Tracked delivery', prices: { EUR: 0, GBP: 0, USD: 0 } },
  // ISO country codes Stripe will accept a delivery address from. Check your printer ships to all of them.
  countries: ['GB', 'IE', 'FR', 'DE', 'NL', 'BE', 'LU', 'AT', 'ES', 'PT', 'IT', 'PL', 'CZ', 'DK', 'SE', 'FI', 'NO', 'CH', 'US', 'CA'],
  // Visitor's country (from Cloudflare) → currency picked for them. Anyone can change it with the picker.
  countryCurrency: { GB: 'GBP', GG: 'GBP', JE: 'GBP', IM: 'GBP', US: 'USD', CA: 'USD', AU: 'USD', NZ: 'USD' },
  // Print on demand with Gelato (worker/printer.js). Needs the GELATO_API_KEY secret.
  printer: {
    // Gelato product id per size (portrait poster, your paper choice). Find them with
    // /api/admin/gelato/products?catalog=posters&q=a3 (see README).
    products: { A3: '', A2: '' },
    // 'draft': each paid order waits in your Gelato dashboard until you press approve (start here).
    // 'order': printed and posted straight away.
    orderType: 'draft',
    shipmentMethodUid: '', // '' = Gelato's default
    dpi: 150, // print file resolution; capped at 4096 px a side (the largest canvas iPhones can draw)
  },
  // Unpaid orders are deleted after this many days; paid ones are kept.
  unpaidDays: 7,
};
