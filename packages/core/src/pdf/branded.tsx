import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";

// The agency-branded page every generated PDF uses (D50, D60): logo or name
// at the top in the agency's colour, its legal details in the footer.
// Built-in Helvetica is used, so text sticks to plain characters.

export interface Brand {
  name: string;
  colour: string;
  logo: { data: Buffer; format: "png" | "jpg" } | null;
  legalName: string | null;
  registrationNo: string | null;
  ffcNumber: string | null;
  vatNumber: string | null;
  physicalAddress: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
}

export const styles = StyleSheet.create({
  page: { padding: 40, paddingBottom: 70, fontSize: 10, fontFamily: "Helvetica", color: "#111111" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 },
  logo: { maxHeight: 48, maxWidth: 160, objectFit: "contain" },
  agencyName: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  contact: { fontSize: 8, textAlign: "right", color: "#444444", lineHeight: 1.4 },
  title: { fontSize: 18, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  subtitle: { fontSize: 10, color: "#444444", marginBottom: 16 },
  label: { fontSize: 8, color: "#666666", textTransform: "uppercase" },
  value: { fontSize: 10, marginBottom: 8 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#dddddd", paddingVertical: 4 },
  headRow: { flexDirection: "row", borderBottomWidth: 1, paddingVertical: 4, fontFamily: "Helvetica-Bold" },
  muted: { color: "#888888" },
  right: { textAlign: "right" },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    fontSize: 7,
    color: "#666666",
    borderTopWidth: 0.5,
    borderTopColor: "#cccccc",
    paddingTop: 6,
    textAlign: "center",
  },
});

function legalLine(b: Brand): string {
  return [
    b.legalName ?? b.name,
    b.registrationNo ? `Reg. ${b.registrationNo}` : null,
    b.ffcNumber ? `FFC ${b.ffcNumber}` : null,
    b.vatNumber ? `VAT ${b.vatNumber}` : null,
  ]
    .filter(Boolean)
    .join("  |  ");
}

export function BrandedDocument({
  brand,
  title,
  children,
  extraPages,
}: {
  brand: Brand;
  title: string;
  children: ReactNode;
  /** Pages after the branded one, e.g. a signing certificate */
  extraPages?: ReactNode;
}) {
  return (
    <Document title={title} author={brand.legalName ?? brand.name} creator="AWDRent" producer="AWDRent">
      <Page size="A4" style={styles.page}>
        <View style={styles.header} fixed>
          {brand.logo ? (
            <Image src={brand.logo} style={styles.logo} />
          ) : (
            <Text style={[styles.agencyName, { color: brand.colour }]}>{brand.name}</Text>
          )}
          <View>
            {[brand.physicalAddress, brand.contactPhone, brand.contactEmail].filter(Boolean).map((line) => (
              <Text key={line} style={styles.contact}>
                {line}
              </Text>
            ))}
          </View>
        </View>
        {children}
        <Text style={styles.footer} fixed render={({ pageNumber, totalPages }) => `${legalLine(brand)}   Page ${pageNumber} of ${totalPages}`} />
      </Page>
      {extraPages}
    </Document>
  );
}
