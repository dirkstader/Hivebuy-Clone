// Carries request-new.tsx's in-progress draft (and the punch-out result) across the in-SPA
// route change to /punchout/shop/:buyerCookie and back. NOT sessionStorage: this runtime blocks
// all Web Storage (see server/auth.ts's comment + README), so this is a plain module-level
// variable instead — same single-tab-lifetime persistence, but pure JS memory, exactly like
// how the auth token itself is already handled.
export interface PunchoutDraftLine {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface StashedDraft {
  buyerCookie: string;
  title: string;
  justification: string;
  costCenterId: string;
  supplierId: string;
  lines: PunchoutDraftLine[];
  returnedSessionId?: number;
}

let stashed: StashedDraft | null = null;

export function stashPunchoutDraft(draft: StashedDraft): void {
  stashed = draft;
}

export function setPunchoutReturnedSessionId(buyerCookie: string, sessionId: number): void {
  if (stashed && stashed.buyerCookie === buyerCookie) {
    stashed = { ...stashed, returnedSessionId: sessionId };
  }
}

export function takePunchoutDraft(): StashedDraft | null {
  const draft = stashed;
  stashed = null;
  return draft;
}
