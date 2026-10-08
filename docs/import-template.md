# Importing an agency's spreadsheets

For the person preparing an agency's existing data for AWDRent. An agency
admin runs the import from **Import** in the back office.

## How it works

1. Download the five templates from the Import page: `owners.csv`,
   `properties.csv`, `units.csv`, `tenants.csv`, `leases.csv`. Each has every
   column and one example row to overwrite.
2. Fill them in (Excel is fine; save as CSV — comma or semicolon both work).
3. Choose the files and press **Check files**. Every row is checked with the
   same rules as the on-screen forms, and every problem is listed by file, row
   and column. Nothing is saved.
4. Fix and check again until there are no errors. Warnings (for example a
   tenant without recorded consent) do not block the import.
5. Press **Import**. The files are checked once more and then imported in one
   go: either every row is saved, or — if anything fails — none is.

You can import in parts (for example owners, properties and units first), but
rows only link to other rows **in the same import**: a lease must be imported
together with its unit and tenants.

## Linking rows: your own reference codes

Use any short code that is unique within its file, e.g. `O1`, `P1`, `T1`.
They only link rows during the import and are not stored.

| Code | Defined in | Used in |
|------|------------|---------|
| `owner_ref` | owners.csv | properties.csv |
| `property_ref` | properties.csv | units.csv, leases.csv |
| `tenant_ref` | tenants.csv | leases.csv (`primary_tenant_ref`, `co_tenant_refs`) |

A unit is identified by `property_ref` + `unit_label`.

## Formats

| Kind | Accepted |
|------|----------|
| Dates | `31/10/2026` (day first) or `2026-10-31` |
| Money | `8500`, `8500.00`, `8 500,00`, `R8500` |
| Percentages | `10`, `8.5`, `8,5` |
| Yes/no | `yes`/`no`, `y`/`n`, `true`/`false`, `1`/`0` |
| Several codes | separated by `;` or `|`, e.g. `T2;T3` |

## Columns

Required columns are in **bold**.

### owners.csv

| Column | Notes |
|--------|-------|
| **owner_ref** | Your code |
| **name** | Full or registered name |
| **commission_percent** | e.g. `10` |
| kind | `individual` (default), `company` or `trust` |
| id_or_reg_no | SA ID (checked), passport, or company/trust registration number. Stored encrypted. |
| email, phone, postal_address | |
| vat_registered, vat_number | VAT number required if registered |
| bank_name, bank_branch_code, bank_account_holder, bank_account_no | All four, or none. Account number stored encrypted. |
| notes | |

### properties.csv

| Column | Notes |
|--------|-------|
| **property_ref**, **owner_ref** | |
| **name** | e.g. `12 Oak Street` or `Sunset Court` |
| **address_line1**, **city** | |
| type | `house` (default), `apartment_block`, `complex`, `commercial`, `mixed_use`, `other` |
| address_line2, suburb, province, postal_code (4 digits), notes | |

### units.csv

| Column | Notes |
|--------|-------|
| **property_ref**, **unit_label** | A house usually has one unit, e.g. `Main house` |
| bedrooms, bathrooms | Whole numbers |
| status | `vacant` (default), `occupied`, `notice_given`, `under_maintenance`. Units with an imported active lease are set to occupied automatically. |
| notes | |

### tenants.csv

| Column | Notes |
|--------|-------|
| **tenant_ref**, **full_name** | |
| id_kind, id_number | `sa_id` (default, checked) or `passport`. Stored encrypted. |
| email, phone | Needed if the matching opt-in is yes |
| employer, emergency_contact_name, emergency_contact_phone | |
| consent_given | `yes` only if the tenant has consented to processing of their information (POPIA). |
| email_opt_in, sms_opt_in, whatsapp_opt_in | Channels the tenant agreed to receive messages on |
| notes | |

### leases.csv

| Column | Notes |
|--------|-------|
| **property_ref**, **unit_label** | The unit being let |
| **primary_tenant_ref** | Main tenant |
| **status** | `active`, `notice_given`, `draft` or `ended` |
| **start_date**, **rent**, **due_day** (1–31) | |
| co_tenant_refs | Other tenants on the lease |
| eft_reference | The reference tenants already pay with — keep it so they need not change anything. 3–20 letters, digits or dashes; must be unique. Leave empty to have one assigned (e.g. `KL-0043`). |
| end_date | Empty = month-to-month |
| deposit, escalation_percent, escalation_date, notice_days (default 30), notes | Escalation % and date go together |
| billing_starts | The first month AWDRent charges rent for, e.g. `2026-11` or `11/2026`. **Empty = the month after the import**, so months already settled in the old system are not charged again. |
| opening_balance | What the tenant owes today: positive for arrears (`2500`), negative or in brackets for credit (`-1500` or `(1500)`). Only for active or notice-given leases. |

Two active or notice-given leases on the same unit may not overlap in dates.
