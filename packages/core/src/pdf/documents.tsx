import { renderToBuffer, Text, View } from "@react-pdf/renderer";
import { type Brand, BrandedDocument, styles } from "./branded";

// Receipt and statement layouts. Amounts arrive already formatted.

export interface ReceiptData {
  receiptNumber: string;
  issuedOn: string;
  paidOn: string;
  amount: string;
  tenantNames: string[];
  dwelling: string;
  eftReference: string;
  method: string;
  /** What the payment paid for (Rental Housing Act: purpose and period). */
  allocations: { description: string; amount: string }[];
  creditCarried: string | null;
  balanceAfter: string;
}

export function ReceiptPdf({ brand, r }: { brand: Brand; r: ReceiptData }) {
  return (
    <BrandedDocument brand={brand} title={`Receipt ${r.receiptNumber}`}>
      <Text style={[styles.title, { color: brand.colour }]}>Receipt</Text>
      <Text style={styles.subtitle}>
        {r.receiptNumber}  |  issued {r.issuedOn}
      </Text>
      <View style={{ flexDirection: "row", gap: 24, marginBottom: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Received from</Text>
          <Text style={styles.value}>{r.tenantNames.join(", ")}</Text>
          <Text style={styles.label}>Dwelling</Text>
          <Text style={styles.value}>{r.dwelling}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Amount received</Text>
          <Text style={[styles.value, { fontSize: 16, fontFamily: "Helvetica-Bold" }]}>{r.amount}</Text>
          <Text style={styles.label}>Paid on</Text>
          <Text style={styles.value}>
            {r.paidOn} by {r.method}, reference {r.eftReference}
          </Text>
        </View>
      </View>
      <View style={styles.headRow}>
        <Text style={{ flex: 3 }}>Paid towards</Text>
        <Text style={[{ flex: 1 }, styles.right]}>Amount</Text>
      </View>
      {r.allocations.map((a) => (
        <View key={a.description} style={styles.row}>
          <Text style={{ flex: 3 }}>{a.description}</Text>
          <Text style={[{ flex: 1 }, styles.right]}>{a.amount}</Text>
        </View>
      ))}
      {r.creditCarried ? (
        <View style={styles.row}>
          <Text style={{ flex: 3 }}>Credit carried forward</Text>
          <Text style={[{ flex: 1 }, styles.right]}>{r.creditCarried}</Text>
        </View>
      ) : null}
      <View style={[styles.row, { borderBottomWidth: 0, marginTop: 8 }]}>
        <Text style={{ flex: 3, fontFamily: "Helvetica-Bold" }}>Balance on the account after this payment</Text>
        <Text style={[{ flex: 1, fontFamily: "Helvetica-Bold" }, styles.right]}>{r.balanceAfter}</Text>
      </View>
      <Text style={[styles.muted, { marginTop: 24, fontSize: 8 }]}>
        Received into the agency&apos;s trust account on behalf of the owner. Keep this receipt for your records.
      </Text>
    </BrandedDocument>
  );
}

export interface StatementData {
  issuedOn: string;
  tenantNames: string[];
  dwelling: string;
  eftReference: string;
  lines: { date: string; description: string; charge: string; payment: string; balance: string; struck: boolean }[];
  balance: string;
  overdue: string;
}

export function StatementPdf({ brand, s }: { brand: Brand; s: StatementData }) {
  return (
    <BrandedDocument brand={brand} title={`Statement ${s.eftReference}`}>
      <Text style={[styles.title, { color: brand.colour }]}>Statement of account</Text>
      <Text style={styles.subtitle}>
        {s.eftReference}  |  {s.dwelling}  |  {s.tenantNames.join(", ")}  |  as at {s.issuedOn}
      </Text>
      <View style={styles.headRow}>
        <Text style={{ flex: 1.2 }}>Date</Text>
        <Text style={{ flex: 3.5 }}>Description</Text>
        <Text style={[{ flex: 1.3 }, styles.right]}>Charge</Text>
        <Text style={[{ flex: 1.3 }, styles.right]}>Payment</Text>
        <Text style={[{ flex: 1.3 }, styles.right]}>Balance</Text>
      </View>
      {s.lines.map((l, i) => (
        <View key={i} style={styles.row} wrap={false}>
          <Text style={{ flex: 1.2 }}>{l.date}</Text>
          <Text style={[{ flex: 3.5 }, l.struck ? styles.muted : {}]}>{l.description}</Text>
          <Text style={[{ flex: 1.3 }, styles.right, l.struck ? styles.muted : {}]}>{l.charge}</Text>
          <Text style={[{ flex: 1.3 }, styles.right, l.struck ? styles.muted : {}]}>{l.payment}</Text>
          <Text style={[{ flex: 1.3 }, styles.right]}>{l.balance}</Text>
        </View>
      ))}
      <View style={{ marginTop: 16, alignItems: "flex-end" }}>
        <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 12 }}>Balance due: {s.balance}</Text>
        <Text style={styles.muted}>of which overdue: {s.overdue}</Text>
        <Text style={[styles.muted, { marginTop: 8 }]}>Pay by EFT using reference {s.eftReference}.</Text>
      </View>
    </BrandedDocument>
  );
}

export const renderReceipt = (brand: Brand, r: ReceiptData) => renderToBuffer(<ReceiptPdf brand={brand} r={r} />);
export const renderStatement = (brand: Brand, s: StatementData) => renderToBuffer(<StatementPdf brand={brand} s={s} />);
