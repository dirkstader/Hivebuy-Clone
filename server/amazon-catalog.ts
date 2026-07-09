// Simulated Amazon Business punch-out product catalog.
//
// PRODUCTION NOTE: In a real integration this file is replaced entirely.
// The flow would be:
//   1. Your system sends a cXML PunchOutSetupRequest to Amazon Business's
//      endpoint (with OAuth/shared-secret credentials issued by Amazon).
//   2. Amazon responds with a one-time StartPage URL — you redirect the user there.
//   3. The user shops on real amazon.de/business, builds a cart, clicks "Submit for approval".
//   4. Amazon POSTs a cXML PunchOutOrderMessage back to your registered callback URL
//      with the selected line items (SKU, description, qty, price, supplier part IDs).
//   5. Your callback parses that XML into line items and attaches them to the
//      purchase request — same shape as `AMAZON_CATALOG` below.
//
// This module fakes steps 2-4 so the rest of the app (punch-out button, cart
// review, line item hand-off) can be built and tested against a realistic
// contract today, then swapped for real cXML parsing later without touching
// any frontend code.

export interface AmazonCatalogItem {
  asin: string;
  name: string;
  description: string;
  unitPrice: number;
  unit: string;
  category: string;
  imageUrl: string;
}

export const AMAZON_CATALOG: AmazonCatalogItem[] = [
  { asin: "B0C9X9YQ2M", name: "Microfaser Brillenputztuch (50er Pack)", description: "Premium Reinigungstücher für Brillengläser, silikonfrei", unitPrice: 24.99, unit: "Pack", category: "Verbrauchsmaterial", imageUrl: "https://m.media-amazon.com/images/I/71QKQ9r2LFL._AC_SL1500_.jpg" },
  { asin: "B08GYKPD8W", name: "Etiketten-Drucker Thermodirekt", description: "Kompakter Etikettendrucker für Preisauszeichnung", unitPrice: 89.90, unit: "Stk.", category: "Büroausstattung", imageUrl: "https://m.media-amazon.com/images/I/61LzYVvSpFL._AC_SL1500_.jpg" },
  { asin: "B0BX8T1KJ8", name: "Aktenvernichter Cross-Cut P-4", description: "DSGVO-konforme Aktenvernichtung, 15 Liter Fangkorb", unitPrice: 129.00, unit: "Stk.", category: "Büroausstattung", imageUrl: "https://m.media-amazon.com/images/I/71wJ0F6q6PL._AC_SL1500_.jpg" },
  { asin: "B09QCT2FMS", name: "Desinfektionsmittel Flächen 1L (12er Karton)", description: "Für Beratungstische und Anprobebereiche", unitPrice: 54.80, unit: "Karton", category: "Hygiene", imageUrl: "https://m.media-amazon.com/images/I/61tqz1BvQJL._AC_SL1500_.jpg" },
  { asin: "B07YTQ8XWK", name: "USB-C Dockingstation 11-in-1", description: "Für Beratungs-PCs an der Kasse", unitPrice: 69.99, unit: "Stk.", category: "IT-Zubehör", imageUrl: "https://m.media-amazon.com/images/I/61iDBv+JnLL._AC_SL1500_.jpg" },
  { asin: "B0CJHV2ZBQ", name: "Ringordner A4 8cm (10er Set)", description: "Für Kundenakten und Rechnungsablage", unitPrice: 32.50, unit: "Set", category: "Büromaterial", imageUrl: "https://m.media-amazon.com/images/I/81nQVh1qQ8L._AC_SL1500_.jpg" },
  { asin: "B0D1M7XQ4T", name: "LED-Schaufensterbeleuchtung dimmbar", description: "Für Produktpräsentation im Schaufenster", unitPrice: 149.00, unit: "Set", category: "Ladeneinrichtung", imageUrl: "https://m.media-amazon.com/images/I/71ZqYh8p2GL._AC_SL1500_.jpg" },
  { asin: "B0BSHF3X9Q", name: "Kassenrolle thermisch 80mm (50er Pack)", description: "Für POS-Terminals", unitPrice: 38.90, unit: "Pack", category: "Verbrauchsmaterial", imageUrl: "https://m.media-amazon.com/images/I/71xK3xg5yJL._AC_SL1500_.jpg" },
];
