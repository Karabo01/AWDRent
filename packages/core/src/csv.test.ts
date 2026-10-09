import { describe, expect, it } from "vitest";
import { csvField, csvRands, toCsv } from "./csv";

describe("CSV", () => {
  it("quotes what needs quoting and defuses formulas", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField('He said "hi", then left')).toBe('"He said ""hi"", then left"');
    expect(csvField("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvField("-2+3")).toBe("'-2+3");
    expect(csvField("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvField(-1234.5)).toBe("-1234.5");
    expect(csvField(null)).toBe("");
  });

  it("writes rows with CRLF and amounts in rands", () => {
    expect(toCsv(["a", "b"], [["x", 1]])).toBe("a,b\r\nx,1\r\n");
    expect(csvRands(123456)).toBe("1234.56");
    expect(csvRands(5)).toBe("0.05");
  });
});
