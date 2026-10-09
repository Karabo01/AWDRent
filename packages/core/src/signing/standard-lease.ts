// The standard South African residential lease AWDRent ships (D51). It sets
// out what section 5 of the Rental Housing Act 50 of 1999 requires a lease to
// contain, and the Consumer Protection Act 68 of 2008 (section 14) rules on
// fixed-term agreements. Each agency adapts it in Settings. It is a starting
// point for the agency's attorney to review, not legal advice.
//
// {merge_fields} are filled from the lease when the document is prepared; see
// LEASE_FIELDS for the list.

export interface Section {
  heading: string;
  body: string;
}

export const LEASE_FIELDS: Record<string, string> = {
  agency_name: "The agency's trading name",
  agency_legal_name: "The agency's registered name",
  agency_registration_no: "Company registration number",
  agency_ffc: "Fidelity Fund Certificate number",
  agency_address: "The agency's office address",
  landlord_name: "The owner of the property",
  landlord_address: "The owner's postal address",
  landlord_signatory: "Who signs for the landlord (owner, or agent under mandate)",
  tenant_names: "All tenants, e.g. Ayanda Khumalo and Sipho Nkosi",
  tenant_details: "Each tenant with their (masked) ID or passport number",
  property_address: "The dwelling: unit, property and street address",
  start_date: "First day of the lease",
  lease_term: "The period: fixed term with end date, or month to month",
  rent: "Monthly rent, e.g. R8 500,00",
  due_day: "Day of the month rent is due, e.g. 1st",
  escalation: "The rent escalation, or that there is none",
  deposit: "The deposit, e.g. R17 000,00",
  notice_days: "Notice period in days",
  eft_reference: "The tenant's payment reference",
  trust_bank: "Trust account bank",
  trust_account_holder: "Trust account holder",
  trust_account_number: "Trust account number",
  trust_branch_code: "Trust account branch code",
};

export const STANDARD_LEASE: Section[] = [
  {
    heading: "Parties",
    body: "This agreement of lease is entered into between {landlord_name} (\"the Landlord\"), of {landlord_address}, represented for the purposes of this lease by {landlord_signatory}, and {tenant_details} (together \"the Tenant\"). The lease is managed by {agency_legal_name} (registration number {agency_registration_no}, Fidelity Fund Certificate {agency_ffc}) trading as {agency_name} (\"the Agent\"), of {agency_address}.",
  },
  {
    heading: "The dwelling",
    body: "The Landlord lets to the Tenant, who hires, the dwelling at {property_address} (\"the Premises\"), together with the fixtures and fittings in it, for use as a private residence only by the Tenant and their immediate household.",
  },
  {
    heading: "Period of the lease",
    body: "The lease begins on {start_date} and runs for {lease_term}. Where the lease is for a fixed term, the Landlord will notify the Tenant not more than 80 and not less than 40 business days before it ends that it is about to expire, and of any changes that will apply if it is renewed. If the Tenant stays on after a fixed term without a new agreement, the lease continues from month to month on the same terms, unless either party gives notice to end it, as the Consumer Protection Act provides.",
  },
  {
    heading: "Rent",
    body: "The rent is {rent} per month, payable in advance on or before the {due_day} day of each month, without deduction or set-off. The Tenant pays by electronic transfer into the Agent's trust account: {trust_bank}, account holder {trust_account_holder}, account number {trust_account_number}, branch code {trust_branch_code}, always using the reference {eft_reference}. The Agent issues a written receipt for every payment received. Rent is only treated as paid once it reflects in the trust account.",
  },
  {
    heading: "Escalation",
    body: "{escalation}",
  },
  {
    heading: "Deposit",
    body: "Before taking occupation the Tenant pays a deposit of {deposit}. The Agent invests the deposit in an interest-bearing account with a financial institution, as the Rental Housing Act requires; the interest accrues to the Tenant, and the Tenant may ask for proof of the interest earned at any time. The deposit may not be used by the Tenant as payment of rent. When the lease ends, the Landlord may apply the deposit and interest to rent and other amounts the Tenant owes and to the reasonable cost of repairing damage to the Premises found at the outgoing inspection (fair wear and tear excepted), and refunds the balance with the receipts for the repairs: within 7 days of the end of the lease if nothing is owed, within 14 days of the Premises being restored if amounts are deducted, and within 21 days of the end of the lease if the Tenant fails to attend the outgoing inspection.",
  },
  {
    heading: "Inspections",
    body: "The Landlord (or the Agent) and the Tenant will inspect the Premises together before the Tenant moves in and record any defects or damage in a written inspection report, which forms part of this lease. They will inspect the Premises together again within 3 days before the Tenant moves out. If the Landlord fails to arrange the incoming or outgoing inspection, the Landlord is taken to accept that the Premises are in good order and must refund the full deposit and interest.",
  },
  {
    heading: "Utilities and other charges",
    body: "Unless agreed otherwise in writing, the Tenant pays for the electricity and water used at the Premises, as metered or as charged by the municipality or the body corporate, and any other charges agreed in writing. These charges are added to the Tenant's account and are payable with the next month's rent.",
  },
  {
    heading: "Use of the premises and house rules",
    body: "The Tenant will keep the Premises clean and in good order, use them only as a residence, not cause a nuisance to neighbours, and comply with the rules of any sectional title scheme, home owners' association or estate in which the Premises are situated, a copy of which will be given to the Tenant. The Tenant may not keep pets without the Landlord's written consent, which will not be unreasonably withheld.",
  },
  {
    heading: "Maintenance and repairs",
    body: "The Landlord keeps the structure of the Premises, including the roof, walls, plumbing, electrical installation and geyser, in a good state of repair, and repairs damage not caused by the Tenant. The Tenant reports defects to the Agent promptly in writing, and is responsible for damage caused by the Tenant, their household or visitors, and for replacing light bulbs and similar minor items. The Tenant may not make alterations or additions to the Premises without the Landlord's written consent.",
  },
  {
    heading: "Access",
    body: "The Landlord and the Agent may enter the Premises at reasonable times, after giving the Tenant reasonable notice, to inspect them, carry out repairs, or show them to prospective tenants or buyers. The Tenant's right to privacy is respected; the Landlord may not enter without notice except in an emergency.",
  },
  {
    heading: "Subletting and assignment",
    body: "The Tenant may not sublet the Premises or any part of them, cede or assign this lease, or give occupation to anyone else, without the Landlord's prior written consent.",
  },
  {
    heading: "Ending the lease early",
    body: "The Tenant may cancel a fixed-term lease at any time by giving the Landlord at least 20 business days' written notice; the Landlord may then charge a reasonable cancellation penalty, as the Consumer Protection Act allows, taking into account the remaining rent, the Landlord's efforts to find a new tenant and the costs of doing so. A month-to-month lease may be ended by either party on {notice_days} days' written notice.",
  },
  {
    heading: "Breach",
    body: "If the Tenant fails to pay any amount when due or breaches any other term of this lease, and fails to remedy the breach within 20 business days of written notice from the Landlord or the Agent, the Landlord may cancel the lease, without prejudice to any other rights the Landlord has, including the right to claim arrear rent and damages. The Tenant may only be evicted under an order of court, in terms of the Prevention of Illegal Eviction from and Unlawful Occupation of Land Act 19 of 1998.",
  },
  {
    heading: "Personal information",
    body: "The Tenant consents to the Agent and the Landlord processing the Tenant's personal information for the purposes of this lease, including payment records, communication about the lease, and, where agreed, credit checks, in accordance with the Protection of Personal Information Act 4 of 2013. The Tenant may choose how the Agent may contact them, and may ask to see or correct their information.",
  },
  {
    heading: "Notices and addresses",
    body: "The parties choose the addresses in this lease, and in the Tenant's case the Premises, as the addresses at which legal notices may be delivered. Notices may also be given by email to the addresses the parties have given the Agent.",
  },
  {
    heading: "Whole agreement and signature",
    body: "This lease, with the inspection reports, is the whole agreement between the parties; changes are only valid if in writing and signed by both. The parties agree that this lease may be signed electronically, as the Electronic Communications and Transactions Act 25 of 2002 allows, and that an electronic signature has the same effect as a handwritten one. Disputes may be referred to the Rental Housing Tribunal.",
  },
];

export const CONFIRMATION_LETTER_FIELDS = ["date", "property_address", "agent_name", "agency_name", "start_date", "end_date", "tenant_list"];
