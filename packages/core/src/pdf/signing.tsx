import { Image, Page, renderToBuffer, Text, View } from "@react-pdf/renderer";
import { type Brand, BrandedDocument, styles } from "./branded";

// Lease agreements and confirmation letters (D51, D54), unsigned for
// signing and signed with a certificate page (D47). The content is the
// envelope's frozen copy, so every version shows the same words.

export interface SignatureBlock {
  name: string;
  capacity: string;
}

export interface LeaseContent {
  kind: "lease_agreement";
  title: string;
  preparedOn: string;
  sections: { heading: string; body: string }[];
  blocks: SignatureBlock[];
}

export interface LetterContent {
  kind: "confirmation_letter";
  title: string;
  preparedOn: string;
  propertyAddress: string;
  agentName: string;
  agencyName: string;
  startDate: string;
  endDate: string | null;
  tenants: string[];
  blocks: SignatureBlock[];
}

export type EnvelopeContent = LeaseContent | LetterContent;

export interface AppliedSignature {
  signedName: string;
  signedAt: string;
  image: Buffer;
}

export interface Certificate {
  envelopeId: string;
  documentSha256: string;
  completedAt: string;
  signers: { name: string; capacity: string; contact: string; signedAt: string; ipAddress: string; userAgent: string }[];
}

const s = {
  heading: { fontSize: 10, fontFamily: "Helvetica-Bold", marginTop: 10, marginBottom: 3 },
  body: { fontSize: 9.5, lineHeight: 1.45, textAlign: "justify" as const },
  centreTitle: { fontSize: 16, fontFamily: "Helvetica-Bold", textAlign: "center" as const, marginVertical: 14 },
  para: { fontSize: 10.5, lineHeight: 1.5, marginBottom: 8 },
  bold: { fontFamily: "Helvetica-Bold" },
  blocks: { flexDirection: "row" as const, flexWrap: "wrap" as const, marginTop: 24, gap: 18 },
  block: { width: 230, marginBottom: 16 },
  sigArea: { height: 46, borderBottomWidth: 0.75, borderBottomColor: "#333333", justifyContent: "flex-end" as const },
  sigImage: { height: 42, maxWidth: 220, objectFit: "contain" as const },
  blockText: { fontSize: 9, marginTop: 3 },
  watermark: {
    position: "absolute" as const,
    top: 360,
    left: 60,
    fontSize: 54,
    color: "#e5e5e5",
    transform: "rotate(-30deg)",
    fontFamily: "Helvetica-Bold",
  },
  certRow: { flexDirection: "row" as const, borderBottomWidth: 0.5, borderBottomColor: "#dddddd", paddingVertical: 5 },
};

function Blocks({ blocks, signatures }: { blocks: SignatureBlock[]; signatures?: (AppliedSignature | null)[] }) {
  return (
    <View style={s.blocks} wrap={false}>
      {blocks.map((b, i) => {
        const sig = signatures?.[i] ?? null;
        return (
          <View key={`${b.name}-${i}`} style={s.block}>
            <View style={s.sigArea}>{sig ? <Image src={{ data: sig.image, format: "png" }} style={s.sigImage} /> : null}</View>
            <Text style={[s.blockText, s.bold]}>{b.name}</Text>
            <Text style={s.blockText}>{b.capacity}</Text>
            <Text style={[s.blockText, styles.muted]}>{sig ? `Signed electronically on ${sig.signedAt}` : "Signature and date"}</Text>
          </View>
        );
      })}
    </View>
  );
}

function CertificatePage({ brand, certificate }: { brand: Brand; certificate: Certificate }) {
  return (
    <Page size="A4" style={styles.page}>
      <Text style={styles.title}>Signing certificate</Text>
      <Text style={styles.subtitle}>
        Signed electronically on AWDRent for {brand.legalName ?? brand.name}. Each signer opened a personal link and confirmed it was them with a
        one-time code sent to their email address or phone before signing.
      </Text>
      <Text style={styles.label}>Document fingerprint (SHA-256 of the document signed)</Text>
      <Text style={[styles.value, { fontFamily: "Courier", fontSize: 8 }]}>{certificate.documentSha256}</Text>
      <Text style={styles.label}>Reference</Text>
      <Text style={styles.value}>{certificate.envelopeId}</Text>
      <Text style={styles.label}>Completed</Text>
      <Text style={styles.value}>{certificate.completedAt}</Text>
      <View style={[styles.headRow, { marginTop: 8 }]}>
        <Text style={{ width: "28%" }}>Signer</Text>
        <Text style={{ width: "22%" }}>Code sent to</Text>
        <Text style={{ width: "22%" }}>Signed (SAST)</Text>
        <Text style={{ width: "28%" }}>IP address and device</Text>
      </View>
      {certificate.signers.map((x) => (
        <View key={`${x.name}-${x.signedAt}`} style={s.certRow} wrap={false}>
          <View style={{ width: "28%", paddingRight: 4 }}>
            <Text style={s.bold}>{x.name}</Text>
            <Text style={styles.muted}>{x.capacity}</Text>
          </View>
          <Text style={{ width: "22%", paddingRight: 4 }}>{x.contact}</Text>
          <Text style={{ width: "22%", paddingRight: 4 }}>{x.signedAt}</Text>
          <View style={{ width: "28%" }}>
            <Text>{x.ipAddress}</Text>
            <Text style={[styles.muted, { fontSize: 7 }]}>{x.userAgent.slice(0, 120)}</Text>
          </View>
        </View>
      ))}
      <Text style={styles.footer} fixed>
        Electronic signatures under the Electronic Communications and Transactions Act 25 of 2002.
      </Text>
    </Page>
  );
}

function LeaseBody({ content, signatures }: { content: LeaseContent; signatures?: (AppliedSignature | null)[] }) {
  return (
    <>
      <Text style={styles.title}>{content.title}</Text>
      <Text style={styles.subtitle}>Prepared on {content.preparedOn}</Text>
      {content.sections.map((sec, i) => (
        <View key={`${i}-${sec.heading}`}>
          <Text style={s.heading} minPresenceAhead={30}>
            {i + 1}. {sec.heading}
          </Text>
          <Text style={s.body}>{sec.body}</Text>
        </View>
      ))}
      {/* Kept with the signature blocks, never alone at the foot of a page */}
      <View wrap={false}>
        <Text style={[s.heading, { marginTop: 20 }]}>Signatures</Text>
        <Blocks blocks={content.blocks} signatures={signatures} />
      </View>
    </>
  );
}

function LetterBody({ content, signatures }: { content: LetterContent; signatures?: (AppliedSignature | null)[] }) {
  return (
    <>
      <Text style={[s.para, { textAlign: "right" }]}>{content.preparedOn}</Text>
      <Text style={s.centreTitle}>LEASE CONFIRMATION LETTER</Text>
      <Text style={[s.para, s.bold]}>To Whom It May Concern</Text>
      <Text style={s.para}>This letter serves to formally confirm that the residential property situated at:</Text>
      <Text style={[s.para, s.bold]}>{content.propertyAddress}</Text>
      <Text style={s.para}>
        is leased through the Agent, {content.agentName}, on behalf of <Text style={s.bold}>{content.agencyName}</Text>.
      </Text>
      <Text style={s.para}>
        {content.endDate ? (
          <>
            The lease agreement commenced on <Text style={s.bold}>{content.startDate}</Text> and will end on <Text style={s.bold}>{content.endDate}</Text>.
          </>
        ) : (
          <>
            The lease agreement commenced on <Text style={s.bold}>{content.startDate}</Text> and continues from month to month.
          </>
        )}
      </Text>
      <Text style={s.para}>The {content.tenants.length === 1 ? "tenant occupying the property is" : "tenants occupying the property are"}:</Text>
      {content.tenants.map((t, i) => (
        <Text key={t} style={s.para}>
          {i + 1}. {t}
        </Text>
      ))}
      <Text style={s.para}>
        This letter is issued as formal confirmation of the above-mentioned lease arrangement. Should you require any further information or
        verification regarding the lease, please contact the relevant agent or the company using the official contact details.
      </Text>
      <Text style={[s.para, { marginTop: 12 }]}>Yours faithfully,</Text>
      <Blocks blocks={content.blocks} signatures={signatures} />
    </>
  );
}

/**
 * The document as a PDF. Without signatures it is the version sent for
 * signing (its fingerprint is what signers agree to); `draft` adds a
 * watermark for previews; with a certificate it is the signed original.
 */
export async function renderEnvelopeDocument(
  brand: Brand,
  content: EnvelopeContent,
  opts: { draft?: boolean; signatures?: (AppliedSignature | null)[]; certificate?: Certificate } = {},
): Promise<Buffer> {
  const body = content.kind === "lease_agreement" ? <LeaseBody content={content} signatures={opts.signatures} /> : <LetterBody content={content} signatures={opts.signatures} />;
  return renderToBuffer(
    <BrandedDocument
      brand={brand}
      title={content.title}
      extraPages={opts.certificate ? <CertificatePage brand={brand} certificate={opts.certificate} /> : null}
    >
      {opts.draft ? (
        <Text style={s.watermark} fixed>
          DRAFT
        </Text>
      ) : null}
      {body}
    </BrandedDocument>,
  );
}
