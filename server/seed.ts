import { storage } from "./storage";
import { PYLO_COST_CENTERS, PYLO_CATALOG_ITEMS } from "./pylo-data";

// Creates a cost center plus its FY2026 active budget period in one call — cost centers no
// longer carry budget/spent/committed themselves (see shared/schema.ts budgetPeriods).
async function createCostCenterWithPeriod(cc: { name: string; code: string; owner: string; city: string; annualBudget: number; spent: number }) {
  const created = await storage.createCostCenter({ name: cc.name, code: cc.code, owner: cc.owner, city: cc.city });
  const now = new Date().toISOString();
  await storage.createBudgetPeriod({
    costCenterId: created.id, fiscalYear: 2026, budget: cc.annualBudget, spent: cc.spent, committed: 0,
    startsAt: "2026-01-01T00:00:00.000Z", endsAt: "2027-01-01T00:00:00.000Z",
    status: "active", createdAt: now,
  });
  return created;
}

export async function seedIfEmpty() {
  const users = await storage.listUsers();
  if (users.length > 0) return;

  console.log("[seed] Populating OUNDA Procure with real Pylo data (Kostenstellen & Artikelstammdaten)...");

  // Cost centers = echte Betriebe/Standorte aus der Pylo-Datenbank (106 aktive Filialen, Geschlossene ausgeschlossen)
  const pyloCostCenters = await Promise.all(
    PYLO_COST_CENTERS.map((cc) => createCostCenterWithPeriod(cc))
  );
  const ccByCode = new Map(pyloCostCenters.map((cc) => [cc.code, cc]));
  const ccHQ = pyloCostCenters.find((cc) => cc.name.includes("Verwaltung")) ?? pyloCostCenters[0];
  const ccFiliale1 = pyloCostCenters[1] ?? ccHQ;
  const ccFiliale2 = pyloCostCenters[2] ?? ccHQ;
  const ccIT = ccHQ;
  const ccMarketing = pyloCostCenters[3] ?? ccHQ;

  // Users
  const admin = await storage.createUser({ name: "Dirk Stader", email: "dirk@stader.de", password: "demo1234", role: "finance", department: "Geschäftsführung", costCenterId: ccHQ.id });
  const approver1 = await storage.createUser({ name: "Sabine Krüger", email: "sabine.krueger@ounda.de", password: "demo1234", role: "approver", department: `Filialleitung ${ccFiliale1.name}`, costCenterId: ccFiliale1.id });
  const approver2 = await storage.createUser({ name: "Markus Vogt", email: "markus.vogt@ounda.de", password: "demo1234", role: "approver", department: `Filialleitung ${ccFiliale2.name}`, costCenterId: ccFiliale2.id });
  const purchasing = await storage.createUser({ name: "Jana Weiss", email: "jana.weiss@ounda.de", password: "demo1234", role: "purchasing", department: "Einkauf & IT", costCenterId: ccIT.id });
  const requester1 = await storage.createUser({ name: "Lea Brandt", email: "lea.brandt@ounda.de", password: "demo1234", role: "requester", department: ccFiliale1.name, costCenterId: ccFiliale1.id });
  const requester2 = await storage.createUser({ name: "Tobias Reimann", email: "tobias.reimann@ounda.de", password: "demo1234", role: "requester", department: "Marketing", costCenterId: ccMarketing.id });

  // Suppliers
  const supEssilor = await storage.createSupplier({ name: "Essilor Deutschland GmbH", category: "Gläser & Optik", contactName: "Frank Neumann", email: "vertrieb@essilor-demo.de", phone: "+49 30 1234560", address: "Alcon-Allee 1, 41546 Kaarst", rating: 5, status: "active" });
  const supPhonak = await storage.createSupplier({ name: "Phonak Deutschland GmbH", category: "Hörgeräte", contactName: "Nina Sattler", email: "b2b@phonak-demo.de", phone: "+49 711 9876540", address: "Max-Eyth-Straße 20, 70736 Fellbach", rating: 5, status: "active" });
  const supFielmann = await storage.createSupplier({ name: "Marchon Eyewear GmbH", category: "Fassungen", contactName: "Oliver Bach", email: "kontakt@marchon-demo.de", phone: "+49 40 5551234", address: "Speicherstraße 5, 20457 Hamburg", rating: 4, status: "active" });
  const supOffice = await storage.createSupplier({ name: "Büro Schmitz OHG", category: "Büromaterial", contactName: "Petra Lohmann", email: "info@bueroschmitz-demo.de", phone: "+49 251 445566", address: "Hafenweg 12, 48155 Münster", rating: 4, status: "active" });
  const supIT = await storage.createSupplier({ name: "NordIT Systemhaus GmbH", category: "IT-Hardware", contactName: "Kevin Ostermann", email: "sales@nordit-demo.de", phone: "+49 251 998877", address: "Weseler Straße 200, 48151 Münster", rating: 3, status: "active" });
  const supPrint = await storage.createSupplier({ name: "Druckhaus Westfalen", category: "Marketing & Print", contactName: "Anke Vollmer", email: "auftrag@druckhaus-demo.de", phone: "+49 251 334455", address: "Industrieweg 8, 48155 Münster", rating: 4, status: "inactive" });

  // Catalog items
  await storage.createCatalogItem({ supplierId: supEssilor.id, sku: "ESS-VAR-001", name: "Varilux Comfort Gleitsichtglas", description: "Premium-Gleitsichtglas, entspiegelt", unit: "Paar", unitPrice: 189.0, category: "Gläser" });
  await storage.createCatalogItem({ supplierId: supEssilor.id, sku: "ESS-CRZ-014", name: "Crizal Sapphire Entspiegelung", description: "Premium-Beschichtung", unit: "Paar", unitPrice: 45.0, category: "Beschichtung" });
  await storage.createCatalogItem({ supplierId: supPhonak.id, sku: "PHK-AUD-030", name: "Phonak Audéo P90 Hörgerät", description: "Premium-Hörgerät, wiederaufladbar", unit: "Stk.", unitPrice: 1650.0, category: "Hörgeräte" });
  await storage.createCatalogItem({ supplierId: supPhonak.id, sku: "PHK-BAT-013", name: "Phonak Ladestation Compact", description: "Ladestation für Audéo-Serie", unit: "Stk.", unitPrice: 89.0, category: "Zubehör" });
  await storage.createCatalogItem({ supplierId: supFielmann.id, sku: "MAR-FR-220", name: "Marchon Fassung Titan Slim", description: "Titanfassung, unisex", unit: "Stk.", unitPrice: 129.0, category: "Fassungen" });
  await storage.createCatalogItem({ supplierId: supOffice.id, sku: "OFF-PAP-A4", name: "Kopierpapier A4 80g (Palette)", description: "10 Kartons à 5 Pack", unit: "Palette", unitPrice: 340.0, category: "Büromaterial" });
  await storage.createCatalogItem({ supplierId: supIT.id, sku: "NIT-MON-27", name: "27\" Business-Monitor", description: "IPS, 75Hz, USB-C", unit: "Stk.", unitPrice: 279.0, category: "IT-Hardware" });
  await storage.createCatalogItem({ supplierId: supIT.id, sku: "NIT-POS-05", name: "Kassensystem POS-Terminal", description: "Touch-Kassenterminal inkl. Software-Lizenz", unit: "Stk.", unitPrice: 890.0, category: "IT-Hardware" });

  // Echte Artikelstammdaten aus Pylo (Brillenfassungen etc.) — neue Lieferanten je Händler anlegen
  const pyloSupplierByName = new Map<string, Awaited<ReturnType<typeof storage.createSupplier>>>();
  for (const item of PYLO_CATALOG_ITEMS) {
    const supplierName = item.supplierName || "Sonstiger Pylo-Lieferant";
    if (!pyloSupplierByName.has(supplierName)) {
      const sup = await storage.createSupplier({
        name: supplierName,
        category: "Brillen & Optik (Pylo)",
        contactName: "",
        email: "",
        phone: "",
        address: "",
        rating: 4,
        status: "active",
      });
      pyloSupplierByName.set(supplierName, sup);
    }
    const sup = pyloSupplierByName.get(supplierName)!;
    await storage.createCatalogItem({
      supplierId: sup.id,
      sku: item.sku,
      name: item.name,
      description: item.description,
      unit: item.unit,
      unitPrice: item.unitPrice,
      category: item.category,
      brand: item.brand,
      ean: item.ean,
    });
  }
  console.log(`[seed] ${PYLO_CATALOG_ITEMS.length} Pylo-Artikel in den Katalog importiert (${pyloSupplierByName.size} Lieferanten).`);

  const now = () => new Date().toISOString();
  const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

  // Purchase Requests across statuses
  const r1 = await storage.createPurchaseRequest({
    requestNumber: "BA-2026-0041", requesterId: requester1.id, costCenterId: ccFiliale1.id, supplierId: supPhonak.id,
    title: "Nachbestellung Phonak Audéo P90 (5 Stk.)", justification: "Lagerbestand für Filiale Altstadt aufgebraucht, hohe Kundennachfrage.",
    status: "pending_approval", totalAmount: 8250.0, createdAt: daysAgo(2),
  });
  await storage.createLineItem({ requestId: r1.id, description: "Phonak Audéo P90 Hörgerät", quantity: 5, unitPrice: 1650.0 });

  const r2 = await storage.createPurchaseRequest({
    requestNumber: "BA-2026-0038", requesterId: requester2.id, costCenterId: ccMarketing.id, supplierId: supPrint.id,
    title: "Flyer-Nachdruck Frühjahrskampagne", justification: "Kampagne 'Echte Optiker' Frühjahr, Nachdruck für 6 Filialen.",
    status: "rejected", totalAmount: 1240.0, approverId: admin.id, approverComment: "Bitte Angebot von Druckhaus Westfalen erneuern lassen, Lieferant aktuell inaktiv gelistet.",
    createdAt: daysAgo(9), decidedAt: daysAgo(7),
  });
  await storage.createLineItem({ requestId: r2.id, description: "Flyer A5, 4-seitig, 10.000 Stk.", quantity: 1, unitPrice: 1240.0 });

  const r3 = await storage.createPurchaseRequest({
    requestNumber: "BA-2026-0035", requesterId: requester1.id, costCenterId: ccFiliale1.id, supplierId: supEssilor.id,
    title: "Gleitsichtgläser Sammelbestellung Q1", justification: "Sammelbestellung für 12 Kundenaufträge.",
    status: "approved", totalAmount: 2808.0, approverId: approver1.id, approverComment: "Freigegeben, Budget deckt Bestellung.",
    createdAt: daysAgo(14), decidedAt: daysAgo(12),
  });
  await storage.createLineItem({ requestId: r3.id, description: "Varilux Comfort Gleitsichtglas", quantity: 12, unitPrice: 189.0 });
  await storage.createLineItem({ requestId: r3.id, description: "Crizal Sapphire Entspiegelung", quantity: 12, unitPrice: 45.0 });

  const r4 = await storage.createPurchaseRequest({
    requestNumber: "BA-2026-0029", requesterId: purchasing.id, costCenterId: ccIT.id, supplierId: supIT.id,
    title: "2x Kassensystem für Filiale Langenfeld", justification: "Ersatz für ausgefallene Kassenterminals.",
    status: "ordered", totalAmount: 1780.0, approverId: admin.id, approverComment: "Dringend, bitte sofort bestellen.",
    createdAt: daysAgo(22), decidedAt: daysAgo(21),
  });
  await storage.createLineItem({ requestId: r4.id, description: "Kassensystem POS-Terminal", quantity: 2, unitPrice: 890.0 });

  const r5 = await storage.createPurchaseRequest({
    requestNumber: "BA-2026-0021", requesterId: purchasing.id, costCenterId: ccIT.id, supplierId: supIT.id,
    title: "6x Business-Monitore Büroausstattung", justification: "Ausstattung neuer Arbeitsplätze Zentrale.",
    status: "received", totalAmount: 1674.0, approverId: admin.id, approverComment: "Freigegeben.",
    createdAt: daysAgo(35), decidedAt: daysAgo(33),
  });
  const r5Line = await storage.createLineItem({ requestId: r5.id, description: "27\" Business-Monitor", quantity: 6, unitPrice: 279.0 });

  const r6 = await storage.createPurchaseRequest({
    requestNumber: "BA-2026-0044", requesterId: requester1.id, costCenterId: ccFiliale1.id,
    title: "Büromaterial Nachbestellung", justification: "Papier und Verbrauchsmaterial für Filiale.",
    status: "draft", totalAmount: 340.0, createdAt: daysAgo(1),
  });
  await storage.createLineItem({ requestId: r6.id, description: "Kopierpapier A4 80g (Palette)", quantity: 1, unitPrice: 340.0 });

  // Approval chains matching each request's state. r1 (8.250 €) is over the finance
  // threshold, so it has a two-step chain (both still pending); the rest are single-step.
  // r6 is a draft and has no chain yet (built on submit).
  await storage.createApprovalStep({ requestId: r1.id, stepOrder: 1, approverRole: "approver", status: "pending", comment: "", decidedById: null, decidedAt: null });
  await storage.createApprovalStep({ requestId: r1.id, stepOrder: 2, approverRole: "finance", status: "pending", comment: "", decidedById: null, decidedAt: null });
  await storage.createApprovalStep({ requestId: r2.id, stepOrder: 1, approverRole: "approver", status: "rejected", comment: "Bitte Angebot erneuern lassen, Lieferant aktuell inaktiv gelistet.", decidedById: admin.id, decidedAt: daysAgo(7) });
  await storage.createApprovalStep({ requestId: r3.id, stepOrder: 1, approverRole: "approver", status: "approved", comment: "Freigegeben, Budget deckt Bestellung.", decidedById: approver1.id, decidedAt: daysAgo(12) });
  await storage.createApprovalStep({ requestId: r4.id, stepOrder: 1, approverRole: "approver", status: "approved", comment: "Dringend, bitte sofort bestellen.", decidedById: admin.id, decidedAt: daysAgo(21) });
  await storage.createApprovalStep({ requestId: r5.id, stepOrder: 1, approverRole: "approver", status: "approved", comment: "Freigegeben.", decidedById: admin.id, decidedAt: daysAgo(33) });

  // Purchase orders for the "ordered"/"received" requests
  const o1 = await storage.createPurchaseOrder({
    orderNumber: "PO-2026-0114", requestId: r4.id, supplierId: supIT.id, status: "open",
    totalAmount: 1780.0, orderedAt: daysAgo(20), expectedDelivery: daysAgo(-5),
  });
  const o2 = await storage.createPurchaseOrder({
    orderNumber: "PO-2026-0098", requestId: r5.id, supplierId: supIT.id, status: "received",
    totalAmount: 1674.0, orderedAt: daysAgo(32), expectedDelivery: daysAgo(25),
  });

  // o2 was fully received — book the matching goods receipt so the 3-way match holds.
  // (o1 has no receipt yet, matching r4's "ordered" state.)
  const gr = await storage.createGoodsReceipt({ orderId: o2.id, receivedById: purchasing.id, note: "Vollständig geliefert.", receivedAt: daysAgo(26) });
  await storage.createGoodsReceiptLine({ receiptId: gr.id, requestLineItemId: r5Line.id, quantityReceived: 6 });

  // Invoices — a clean 3-way match (o2, fully received) and a discrepancy (o1, billed before receipt)
  await storage.createInvoice({
    invoiceNumber: "RE-88213", orderId: o2.id, supplierId: supIT.id, amount: 1674.0,
    status: "matched", receivedAt: daysAgo(24), dueDate: daysAgo(-6),
    matchNote: "3-Way-Match ok: bestellt, geliefert und berechnet stimmen überein (1.674,00 €).",
  });
  await storage.createInvoice({
    invoiceNumber: "RE-88450", orderId: o1.id, supplierId: supIT.id, amount: 1830.0,
    status: "discrepancy", receivedAt: daysAgo(3), dueDate: daysAgo(-27),
    matchNote: "Abweichung im 3-Way-Match: bestellt 1.780,00 € · geliefert 0,00 € · berechnet 1.830,00 € (Wareneingang unvollständig).",
  });

  // Budget: approved-but-not-invoiced requests reserve budget (Obligo); invoiced ones are
  // realized as actual spend. r3 (approved) and r4 (ordered, invoice still in discrepancy)
  // stay reserved; r5 (received, matched invoice) is realized.
  const periodFiliale1 = await storage.getActivePeriod(ccFiliale1.id);
  const periodIT = await storage.getActivePeriod(ccIT.id);
  if (periodFiliale1) {
    await storage.createBudgetCommitment({ costCenterId: ccFiliale1.id, periodId: periodFiliale1.id, requestId: r3.id, amount: 2808.0, status: "reserved", createdAt: daysAgo(12), resolvedAt: null });
    await storage.updatePeriodCommitted(periodFiliale1.id, 2808.0);
  }
  if (periodIT) {
    await storage.createBudgetCommitment({ costCenterId: ccIT.id, periodId: periodIT.id, requestId: r4.id, amount: 1780.0, status: "reserved", createdAt: daysAgo(21), resolvedAt: null });
    await storage.updatePeriodCommitted(periodIT.id, 1780.0);
    await storage.createBudgetCommitment({ costCenterId: ccIT.id, periodId: periodIT.id, requestId: r5.id, amount: 1674.0, status: "realized", createdAt: daysAgo(33), resolvedAt: daysAgo(24) });
    await storage.updatePeriodSpent(periodIT.id, 1674.0);
  }

  // Activity log
  await storage.createActivity({ entityType: "request", entityId: r3.id, actorId: approver1.id, action: "approved", note: "Freigegeben, Budget deckt Bestellung.", createdAt: daysAgo(12) });
  await storage.createActivity({ entityType: "request", entityId: r2.id, actorId: admin.id, action: "rejected", note: "Lieferant aktuell inaktiv gelistet.", createdAt: daysAgo(7) });
  await storage.createActivity({ entityType: "request", entityId: r4.id, actorId: admin.id, action: "approved", note: "Dringend, bitte sofort bestellen.", createdAt: daysAgo(21) });
  await storage.createActivity({ entityType: "invoice", entityId: 2, actorId: purchasing.id, action: "flagged", note: "Abweichung zum Bestellwert festgestellt.", createdAt: daysAgo(3) });

  // Sabine is on leave and has delegated her approval authority to Jana (Einkauf/Admin) for
  // the next few days — demonstrates the "borrowed authority" delegation model on r1, which
  // is still awaiting an approver-step decision.
  await storage.upsertApprovalDelegation({
    delegatorId: approver1.id, delegateId: purchasing.id,
    startsAt: daysAgo(2), endsAt: daysAgo(-5),
    note: "Urlaubsvertretung", createdAt: daysAgo(2),
  });

  console.log("[seed] Demo data ready.");
}
