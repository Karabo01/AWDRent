import { renderToBuffer, Text, View } from "@react-pdf/renderer";
import { type Brand, BrandedDocument, styles } from "./branded";

// The owner's monthly statement (spec 5; D91–D95), branded for the agency.

export interface OwnerStatementData {
  ownerName: string;
  period: string;
  issuedOn: string;
  lines: { label: string; rent: string; commission: string; vat: string; note: string | null }[];
  opening: string | null;
  rent: string;
  commission: string;
  vat: string;
  /** True when VAT is part of the letting fee rather than added to it */
  vatIncluded: boolean;
  payable: string;
  shortfall: boolean;
}

const col = { label: { width: "46%" }, num: { width: "18%", textAlign: "right" as const } };

function OwnerStatementPdf({ brand, s }: { brand: Brand; s: OwnerStatementData }) {
  return (
    <BrandedDocument brand={brand} title={`Owner statement ${s.period}`}>
      <Text style={styles.title}>Owner statement</Text>
      <Text style={styles.subtitle}>
        {s.period} · issued {s.issuedOn}
      </Text>
      <Text style={styles.label}>Owner</Text>
      <Text style={styles.value}>{s.ownerName}</Text>
      <View style={[styles.headRow, { marginTop: 8 }]}>
        <Text style={col.label}>Property and lease</Text>
        <Text style={col.num}>Rent collected</Text>
        <Text style={col.num}>Commission</Text>
        <Text style={col.num}>VAT</Text>
      </View>
      {s.lines.map((l) => (
        <View key={l.label} style={styles.row} wrap={false}>
          <View style={col.label}>
            <Text>{l.label}</Text>
            {l.note ? <Text style={[styles.muted, { fontSize: 8 }]}>{l.note}</Text> : null}
          </View>
          <Text style={col.num}>{l.rent}</Text>
          <Text style={col.num}>{l.commission}</Text>
          <Text style={col.num}>{l.vat}</Text>
        </View>
      ))}
      <View style={{ marginTop: 16, marginLeft: "46%" }}>
        {s.opening ? (
          <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 }}>
            <Text>Shortfall brought forward</Text>
            <Text>{s.opening}</Text>
          </View>
        ) : null}
        <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 }}>
          <Text>Rent collected</Text>
          <Text>{s.rent}</Text>
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 }}>
          <Text>Less commission</Text>
          <Text>{s.commission}</Text>
        </View>
        {s.vatIncluded ? (
          <Text style={[styles.muted, { fontSize: 8, textAlign: "right" }]}>Commission includes VAT of {s.vat}</Text>
        ) : (
          <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 }}>
            <Text>Less VAT on commission</Text>
            <Text>{s.vat}</Text>
          </View>
        )}
        <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, borderTopWidth: 1, marginTop: 4 }}>
          <Text style={{ fontFamily: "Helvetica-Bold" }}>{s.shortfall ? "Shortfall carried forward" : "Amount payable to you"}</Text>
          <Text style={{ fontFamily: "Helvetica-Bold" }}>{s.payable}</Text>
        </View>
      </View>
      <Text style={[styles.muted, { marginTop: 24, fontSize: 8 }]}>
        Rent is shown when it reaches our trust account. Payments that arrive late, or are reversed by the bank, appear on the next
        statement. Deposits are held in trust and are not paid out.
      </Text>
    </BrandedDocument>
  );
}

export const renderOwnerStatement = (brand: Brand, s: OwnerStatementData) => renderToBuffer(<OwnerStatementPdf brand={brand} s={s} />);
