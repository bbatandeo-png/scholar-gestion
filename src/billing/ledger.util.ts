// The payment ledger (Payment documents) and each invoice's paidAmount are
// two records of the same money. They only drift apart when an invoice's paid
// amount is edited by hand (the "Modification financiere" form) without a
// matching ledger entry - the dashboard reads the ledger while the printed
// lists read the invoice, so the two then disagree by exactly that drift.

export type LedgerInvoice = { _id?: unknown; paidAmount?: number };
export type LedgerPayment = { invoiceId?: unknown; amount?: number };

export type LedgerDivergence = {
  invoiceId: string;
  invoicePaid: number;
  ledgerPaid: number;
  // ledgerPaid - invoicePaid: positive means the dashboard counts money the
  // invoice no longer shows (e.g. a payment "cancelled" on the invoice only).
  difference: number;
};

const toKey = (value: unknown): string => {
  if (value && typeof value === 'object' && '_id' in value) {
    return String(value._id);
  }
  return String(value);
};

const round2 = (value: number) => Math.round(value * 100) / 100;

export function computeLedgerDivergences(
  invoices: LedgerInvoice[],
  payments: LedgerPayment[],
): LedgerDivergence[] {
  const ledgerByInvoice = new Map<string, number>();
  for (const payment of payments) {
    const key = toKey(payment.invoiceId);
    ledgerByInvoice.set(
      key,
      (ledgerByInvoice.get(key) ?? 0) + Number(payment.amount ?? 0),
    );
  }

  const result: LedgerDivergence[] = [];
  for (const invoice of invoices) {
    const invoiceId = toKey(invoice._id);
    const invoicePaid = round2(Number(invoice.paidAmount ?? 0));
    const ledgerPaid = round2(ledgerByInvoice.get(invoiceId) ?? 0);
    const difference = round2(ledgerPaid - invoicePaid);
    if (Math.abs(difference) >= 0.01) {
      result.push({ invoiceId, invoicePaid, ledgerPaid, difference });
    }
  }
  return result;
}
