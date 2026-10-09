import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agencyColumn, createdBy, pk, timestamps, tstz } from "./_columns";
import { agencies } from "./agencies";
import { documents } from "./documents";
import { leases } from "./leases";

// Generated lease documents and built-in e-signing (D47–D49, D51, D54; D81–D86).
// A signing envelope holds a frozen copy of the document's content, so what
// each signer saw is exactly what the final PDF contains. Signers sign in
// order; each gets a personal link and confirms with a one-time code.

export const generatedDocumentKind = pgEnum("generated_document_kind", ["lease_agreement", "confirmation_letter"]);
export const envelopeStatus = pgEnum("envelope_status", ["out_for_signing", "completed", "declined", "cancelled"]);
export const signerRole = pgEnum("signer_role", ["tenant", "owner", "agent", "agency_representative"]);
export const signerStatus = pgEnum("signer_status", ["waiting", "invited", "signed", "declined"]);

/** An agency's own version of a built-in document template (the standard lease). */
export const documentTemplates = pgTable(
  "document_templates",
  {
    id: pk(),
    agencyId: agencyColumn().references(() => agencies.id),
    kind: generatedDocumentKind().notNull(),
    // [{ heading, body }] with {merge_fields}
    sections: jsonb().$type<{ heading: string; body: string }[]>().notNull(),
    ...timestamps,
    createdBy: createdBy(),
  },
  (t) => [uniqueIndex("document_templates_agency_kind_key").on(t.agencyId, t.kind)],
);

export const signingEnvelopes = pgTable(
  "signing_envelopes",
  {
    id: pk(),
    agencyId: agencyColumn().references(() => agencies.id),
    leaseId: uuid().notNull(),
    kind: generatedDocumentKind().notNull(),
    status: envelopeStatus().notNull().default("out_for_signing"),
    // Lease agreements: who signs for the landlord (D48)
    landlordSignatory: text(),
    title: text().notNull(),
    // The frozen document: title, sections and party details, as rendered for signing
    content: jsonb().$type<Record<string, unknown>>().notNull(),
    // SHA-256 of the unsigned PDF every signer was shown
    documentSha256: text().notNull(),
    unsignedDocumentId: uuid().notNull(),
    signedDocumentId: uuid(),
    completedAt: tstz(),
    cancelledAt: tstz(),
    cancelReason: text(),
    ...timestamps,
    createdBy: createdBy(),
  },
  (t) => [
    uniqueIndex("signing_envelopes_agency_id_id_key").on(t.agencyId, t.id),
    index("signing_envelopes_agency_lease_idx").on(t.agencyId, t.leaseId),
    foreignKey({ name: "signing_envelopes_lease_fk", columns: [t.agencyId, t.leaseId], foreignColumns: [leases.agencyId, leases.id] }),
    foreignKey({
      name: "signing_envelopes_unsigned_fk",
      columns: [t.agencyId, t.unsignedDocumentId],
      foreignColumns: [documents.agencyId, documents.id],
    }),
    foreignKey({ name: "signing_envelopes_signed_fk", columns: [t.agencyId, t.signedDocumentId], foreignColumns: [documents.agencyId, documents.id] }),
    check("signing_envelopes_landlord_signatory", sql`${t.landlordSignatory} is null or ${t.landlordSignatory} in ('owner', 'agent')`),
  ],
);

export const signers = pgTable(
  "signers",
  {
    id: pk(),
    agencyId: agencyColumn().references(() => agencies.id),
    envelopeId: uuid().notNull(),
    // Signers with the same position sign in parallel (co-tenants)
    position: integer().notNull(),
    role: signerRole().notNull(),
    // The record behind the signer: tenants.id, owners.id or users.id
    partyId: uuid().notNull(),
    name: text().notNull(),
    // "Tenant", "Landlord", "Agent, for and on behalf of the landlord", ...
    capacity: text().notNull(),
    email: text(),
    // MSISDN
    phone: text(),
    status: signerStatus().notNull().default("waiting"),
    // SHA-256 of the personal link token; the token itself is only ever in the invitation
    tokenHash: text(),
    tokenExpiresAt: tstz(),
    invitedAt: tstz(),
    // One-time code to confirm it is the signer (hash, expiry, wrong tries)
    codeHash: text(),
    codeExpiresAt: tstz(),
    codeAttempts: integer().notNull().default(0),
    codeVerifiedAt: tstz(),
    signedAt: tstz(),
    signedName: text(),
    // PNG of the drawn signature, in the agency's storage area
    signatureKey: text(),
    ipAddress: text(),
    userAgent: text(),
    declinedAt: tstz(),
    declineReason: text(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("signers_agency_token_key").on(t.agencyId, t.tokenHash),
    index("signers_agency_envelope_idx").on(t.agencyId, t.envelopeId),
    foreignKey({ name: "signers_envelope_fk", columns: [t.agencyId, t.envelopeId], foreignColumns: [signingEnvelopes.agencyId, signingEnvelopes.id] }),
  ],
);
