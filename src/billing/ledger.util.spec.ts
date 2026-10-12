import { computeLedgerDivergences } from './ledger.util';

describe('computeLedgerDivergences', () => {
  it('ne signale rien quand le registre correspond aux factures', () => {
    const result = computeLedgerDivergences(
      [{ _id: 'a', paidAmount: 30000 }],
      [
        { invoiceId: 'a', amount: 10000 },
        { invoiceId: 'a', amount: 20000 },
      ],
    );
    expect(result).toEqual([]);
  });

  it('signale un paiement annule sur la facture seule (le registre le compte encore)', () => {
    const result = computeLedgerDivergences(
      [{ _id: 'a', paidAmount: 10000 }],
      [{ invoiceId: 'a', amount: 20000 }],
    );
    expect(result).toEqual([
      {
        invoiceId: 'a',
        invoicePaid: 10000,
        ledgerPaid: 20000,
        difference: 10000,
      },
    ]);
  });

  it('signale une facture payee sans aucun paiement enregistre', () => {
    const result = computeLedgerDivergences(
      [{ _id: 'a', paidAmount: 5000 }],
      [],
    );
    expect(result[0]).toMatchObject({ ledgerPaid: 0, difference: -5000 });
  });

  it('comprend un ecart de quelques francs et ignore les arrondis flottants', () => {
    const result = computeLedgerDivergences(
      [
        { _id: 'a', paidAmount: 10000 },
        { _id: 'b', paidAmount: 0.3 },
      ],
      [
        { invoiceId: 'a', amount: 9992 },
        { invoiceId: 'b', amount: 0.1 },
        { invoiceId: 'b', amount: 0.2 },
      ],
    );
    expect(result).toEqual([
      { invoiceId: 'a', invoicePaid: 10000, ledgerPaid: 9992, difference: -8 },
    ]);
  });

  it('accepte des references peuplees ({_id}) comme des ids simples', () => {
    const result = computeLedgerDivergences(
      [{ _id: { _id: 'a' }, paidAmount: 1000 }],
      [{ invoiceId: { _id: 'a' }, amount: 1000 }],
    );
    expect(result).toEqual([]);
  });

  it('compte les corrections negatives dans le registre', () => {
    const result = computeLedgerDivergences(
      [{ _id: 'a', paidAmount: 10000 }],
      [
        { invoiceId: 'a', amount: 20000 },
        { invoiceId: 'a', amount: -10000 },
      ],
    );
    expect(result).toEqual([]);
  });
});
