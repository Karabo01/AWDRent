import { describe, expect, it } from "vitest";
import { isValidSaId } from "./identity";
import { bpsToPercentString, formatCents, parsePercentToBps, parseRandToCents } from "./money";

describe("parseRandToCents", () => {
  it.each([
    ["1234.56", 123456],
    ["R1234,56", 123456],
    ["R 1 234,5", 123450],
    ["1,234.50", 123450],
    ["7500", 750000],
    ["0.01", 1],
    ["0", 0],
  ])("%s → %i", (input, cents) => {
    expect(parseRandToCents(input)).toBe(cents);
  });

  it.each(["", "abc", "1.234", "-5", "12.3.4", "1e5"])("rejects %s", (input) => {
    expect(parseRandToCents(input)).toBeNull();
  });

  it("formats South African style", () => {
    expect(formatCents(123456).replace(/\s/g, " ")).toMatch(/^R 1.234,56$/);
    expect(formatCents(-500)).toMatch(/^-R 5,00$/);
  });
});

describe("percentages", () => {
  it("parses to basis points without floats", () => {
    expect(parsePercentToBps("10")).toBe(1000);
    expect(parsePercentToBps("8.5")).toBe(850);
    expect(parsePercentToBps("12,25%")).toBe(1225);
    expect(parsePercentToBps("100")).toBe(10000);
    expect(parsePercentToBps("100.01")).toBeNull();
    expect(parsePercentToBps("8.555")).toBeNull();
  });

  it("formats back", () => {
    expect(bpsToPercentString(1050)).toBe("10.5");
    expect(bpsToPercentString(1000)).toBe("10");
    expect(bpsToPercentString(1225)).toBe("12.25");
    expect(bpsToPercentString(5)).toBe("0.05");
  });
});

describe("isValidSaId", () => {
  it("accepts a valid ID and rejects a bad check digit or date", () => {
    expect(isValidSaId("8001015009087")).toBe(true);
    expect(isValidSaId("8001 0150 0908 7")).toBe(true);
    expect(isValidSaId("8001015009086")).toBe(false);
    expect(isValidSaId("8013015009087")).toBe(false);
    expect(isValidSaId("12345")).toBe(false);
  });
});
