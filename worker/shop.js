// Shop settings used by the order server. These prices are what Stripe charges: the page shows them,
// but a price sent by the browser is never trusted. Prices are in major units (45 = £45.00).
// Placeholders: set your own before going live.
export const SHOP = {
  currency: 'GBP',
  productName: 'Pop Art Mixer print',
  sizes: [
    { id: '30x30cm', label: '30×30 cm', price: 45 },
    { id: '50x50cm', label: '50×50 cm', price: 75 },
    { id: '70x70cm', label: '70×70 cm', price: 120 },
  ],
  // One flat delivery rate shown at checkout. price 0 = free delivery.
  shipping: { label: 'Tracked delivery', price: 0 },
  // ISO country codes Stripe will accept a delivery address from.
  countries: ['GB'],
  // Unpaid orders are deleted after this many days; paid ones are kept.
  unpaidDays: 7,
};
