import { describe, expect, it } from "vitest";
import { parseHost } from "./hosts";

describe("parseHost", () => {
  const base = "awdrent.co.za";

  it("recognises the platform console", () => {
    expect(parseHost("admin.awdrent.co.za", base)).toEqual({ kind: "platform" });
    expect(parseHost("ADMIN.awdrent.co.za:443", base)).toEqual({ kind: "platform" });
  });

  it("recognises an agency subdomain", () => {
    expect(parseHost("kl-rentals.awdrent.co.za", base)).toEqual({ kind: "agency", subdomain: "kl-rentals" });
    expect(parseHost("acme.localhost:3000", "localhost")).toEqual({ kind: "agency", subdomain: "acme" });
  });

  it("rejects everything else", () => {
    for (const host of [
      "awdrent.co.za",
      "evil.com",
      "acme.awdrent.co.za.evil.com",
      "a.b.awdrent.co.za",
      "-bad.awdrent.co.za",
      "",
      null,
    ]) {
      expect(parseHost(host, base)).toEqual({ kind: "unknown" });
    }
  });
});
