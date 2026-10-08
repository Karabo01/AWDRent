import { describe, expect, it } from "vitest";
import { fingerprints, matchReferences, parseBankDate, parseStatement } from "./banking";

const single = {
  dateColumn: "Date",
  amountColumn: "Amount",
  creditColumn: null,
  debitColumn: null,
  referenceColumn: "Reference",
  descriptionColumn: "Description",
  dateFormat: "DMY" as const,
  skipRows: 0,
};

describe("bank dates", () => {
  it("reads each profile order and named months", () => {
    expect(parseBankDate("01/10/2026", "DMY")).toBe("2026-10-01");
    expect(parseBankDate("10/01/2026", "MDY")).toBe("2026-10-01");
    expect(parseBankDate("2026-10-01", "YMD")).toBe("2026-10-01");
    expect(parseBankDate("20261001", "YMD")).toBe("2026-10-01");
    expect(parseBankDate("1 Oct 2026", "DMY")).toBe("2026-10-01");
    expect(parseBankDate("31/02/2026", "DMY")).toBeNull();
    expect(parseBankDate("yesterday", "DMY")).toBeNull();
  });
});

describe("parseStatement", () => {
  it("keeps money in, skips money out, and reads SA number formats", () => {
    const csv = [
      "Date,Amount,Reference,Description",
      '01/10/2026,"8,500.00",KL-0001,Deposit KL-0001',
      "02/10/2026,-1200.00,DEBIT ORDER,Insurance",
      '03/10/2026,"6 200,50",kl 0002,',
    ].join("\n");
    const { lines, debits, problems } = parseStatement(csv, single);
    expect(problems).toEqual([]);
    expect(debits).toBe(1);
    expect(lines).toEqual([
      { date: "2026-10-01", amountCents: 850_000, reference: "KL-0001", description: "Deposit KL-0001" },
      { date: "2026-10-03", amountCents: 620_050, reference: "kl 0002", description: null },
    ]);
  });

  it("supports separate credit and debit columns and summary rows above the headings", () => {
    const csv = ["Account: 62000000001", "Statement period: Oct 2026", "Posting Date;Money In;Money Out;Ref", "2026-10-05;7500;;KL0003", "2026-10-06;;500;FEE"].join("\n");
    const { lines, debits } = parseStatement(csv, {
      ...single,
      dateColumn: "Posting Date",
      amountColumn: null,
      creditColumn: "Money In",
      debitColumn: "Money Out",
      referenceColumn: "Ref",
      descriptionColumn: null,
      dateFormat: "YMD",
      skipRows: 2,
    });
    expect(lines.map((l) => [l.date, l.amountCents, l.reference])).toEqual([["2026-10-05", 750_000, "KL0003"]]);
    expect(debits).toBe(1);
  });

  it("stops on unreadable rows or a wrong column heading", () => {
    expect(parseStatement("Date,Amount,Reference\nsoon,100,X", single).problems[0]).toMatch(/Row 2: the date/);
    expect(parseStatement("When,Amount,Reference\n01/10/2026,100,X", single).problems[0]).toMatch(/no column called date/);
  });
});

describe("matchReferences", () => {
  const leases = [
    { id: "a", eftReference: "KL-0042" },
    { id: "b", eftReference: "KL-00421" },
    { id: "c", eftReference: "SMITH12" },
  ];
  it("finds references however the tenant typed them", () => {
    expect(matchReferences("KL-0042 rent Oct", leases)).toEqual(["a"]);
    expect(matchReferences("kl 0042", leases)).toEqual(["a"]);
    expect(matchReferences("PAYMENT KL0042", leases)).toEqual(["a"]);
    expect(matchReferences("smith 12 rent", leases)).toEqual(["c"]);
  });
  it("does not confuse longer numbers or words containing the letters", () => {
    expect(matchReferences("KL-00421", leases)).toEqual(["b"]);
    expect(matchReferences("XKL0042", leases)).toEqual([]);
    expect(matchReferences("rent", leases)).toEqual([]);
  });
  it("reports every lease named, so ambiguous lines go to a person", () => {
    expect(matchReferences("KL-0042 and KL-00421", leases).sort()).toEqual(["a", "b"]);
  });
});

describe("fingerprints", () => {
  it("are stable across files and tell identical same-day payments apart", () => {
    const line = { date: "2026-10-01", amountCents: 100, reference: "KL-0001", description: null };
    const [a, b] = fingerprints([line, line]);
    expect(a).not.toBe(b);
    expect(fingerprints([line])[0]).toBe(a);
  });
});

describe("profileSchema", () => {
  it("accepts a form that sends only the fields for its amount mode", async () => {
    const { profileSchema } = await import("./banking");
    const parsed = profileSchema.parse({ name: "FNB", dateColumn: "Date", amountMode: "single", amountColumn: "Amount", referenceColumn: "Ref", dateFormat: "DMY", skipRows: "0" });
    expect(parsed).toMatchObject({ amountColumn: "Amount", creditColumn: null, debitColumn: null, descriptionColumn: null });
    expect(profileSchema.safeParse({ name: "FNB", dateColumn: "Date", amountMode: "split", referenceColumn: "Ref", dateFormat: "DMY" }).success).toBe(false);
  });
});
