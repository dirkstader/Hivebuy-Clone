export function formatCurrency(value: number) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value);
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "–";
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "–";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));
}

export const REQUEST_STATUS_LABELS: Record<string, string> = {
  draft: "Entwurf",
  pending_approval: "Zur Freigabe",
  approved: "Freigegeben",
  rejected: "Abgelehnt",
  ordered: "Bestellt",
  received: "Erhalten",
  closed: "Abgeschlossen",
};

export const ORDER_STATUS_LABELS: Record<string, string> = {
  open: "Offen",
  partially_received: "Teilweise erhalten",
  received: "Erhalten",
  closed: "Abgeschlossen",
};

export const INVOICE_STATUS_LABELS: Record<string, string> = {
  pending_review: "Prüfung ausstehend",
  matched: "Abgeglichen",
  discrepancy: "Abweichung",
  approved: "Freigegeben",
  paid: "Bezahlt",
};

export function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (["approved", "matched", "paid", "received"].includes(status)) return "default";
  if (["rejected", "discrepancy"].includes(status)) return "destructive";
  if (["pending_approval", "pending_review"].includes(status)) return "secondary";
  return "outline";
}
