// Mirrors server/amazon-catalog.ts — kept as a lightweight shared type so the
// frontend doesn't need to import server-only code.
export interface AmazonCatalogItem {
  asin: string;
  name: string;
  description: string;
  unitPrice: number;
  unit: string;
  category: string;
  imageUrl: string;
}
