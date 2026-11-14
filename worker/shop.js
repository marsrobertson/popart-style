// Shop settings used by the order server. These prices are what Stripe charges: the page shows them,
// but a price sent by the browser is never trusted. Prices are in major units (55 = €55.00).
// Placeholders: set your own before going live.
export const SHOP = {
  currencies: ['EUR', 'GBP', 'USD'],
  defaultCurrency: 'EUR',
  productName: 'Pop Art Mixer print',
  sizes: [
    { id: '30x30cm', label: '30×30 cm', prices: { EUR: 55, GBP: 45, USD: 59 } },
    { id: '50x50cm', label: '50×50 cm', prices: { EUR: 89, GBP: 75, USD: 95 } },
    { id: '70x70cm', label: '70×70 cm', prices: { EUR: 139, GBP: 120, USD: 149 } },
  ],
  // A real €1 / £1 / $1 payment for testing the whole flow in live mode. Hidden: it only appears when the page
  // is opened with ?test=1 at the end of the address. Orders for it are marked test: true and are not printed.
  testSize: { id: 'test', label: 'Test order', prices: { EUR: 1, GBP: 1, USD: 1 }, test: true },
  // One flat delivery rate shown at checkout. 0 = free delivery.
  shipping: { label: 'Tracked delivery', prices: { EUR: 0, GBP: 0, USD: 0 } },
  // ISO country codes Stripe will accept a delivery address from. Check your printer ships to all of them.
  countries: ['GB', 'IE', 'FR', 'DE', 'NL', 'BE', 'LU', 'AT', 'ES', 'PT', 'IT', 'PL', 'CZ', 'DK', 'SE', 'FI', 'NO', 'CH', 'US', 'CA'],
  // Visitor's country (from Cloudflare) → currency picked for them. Anyone can change it with the picker.
  countryCurrency: { GB: 'GBP', GG: 'GBP', JE: 'GBP', IM: 'GBP', US: 'USD', CA: 'USD', AU: 'USD', NZ: 'USD' },
  // Unpaid orders are deleted after this many days; paid ones are kept.
  unpaidDays: 7,
};
