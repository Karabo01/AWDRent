import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { allowedVariables, CATALOGUE, SAMPLE_VALUES } from "./catalogue";
import { fromAddress } from "./providers";
import {
  fitSms,
  gsmLength,
  messageBalance,
  messageMoney,
  outsideQuietHours,
  renderEmail,
  renderText,
  toGsm,
  toMsisdn,
  unknownVariables,
} from "./render";
import { advancesStatus, clickatellStatus, resendStatus, verifyBasicAuth, verifySvix } from "./webhooks";

describe("catalogue", () => {
  it("has the spec's 17 messages plus 3 for signing, each fitting one SMS with typical details", () => {
    expect(CATALOGUE.size).toBe(20);
    for (const entry of CATALOGUE.values()) {
      const allowed = allowedVariables(entry);
      expect(unknownVariables(`${entry.sms ?? ""} ${entry.emailSubject} ${entry.email}`, allowed), entry.key).toEqual([]);
      for (const v of allowed) expect(SAMPLE_VALUES[v], `${entry.key}: sample for {${v}}`).toBeDefined();
      if (entry.sms) expect(gsmLength(fitSms(entry.sms, SAMPLE_VALUES, null).text), entry.key).toBeLessThanOrEqual(160);
      if (entry.channels.includes("sms")) expect(entry.sms, entry.key).not.toBeNull();
    }
  });
});

describe("rendering", () => {
  it("fills known variables and leaves the rest", () => {
    expect(renderText("Hi {name}, {missing} R{amount}", { name: "Thandi", amount: "1,00" })).toBe("Hi Thandi, {missing} R1,00");
    expect(renderText("{name}", { name: "$& $1" })).toBe("$& $1");
  });

  it("rewrites text into the GSM alphabet", () => {
    expect(toGsm("Zoë’s “flat” – 2…")).toBe(`Zoe's "flat" - 2...`);
    expect(toGsm("Müller café Ñ")).toBe("Müller café Ñ");
    expect(toGsm("emoji 🙂")).toBe("emoji ?");
    expect(gsmLength("a{b}€")).toBe(8);
  });

  it("adds the opt-out link only when the SMS stays one segment", () => {
    const short = fitSms("Hi {name}", { name: "Sipho" }, " Opt out: x.test/o/abc");
    expect(short).toEqual({ text: "Hi Sipho Opt out: x.test/o/abc", optOutIncluded: true });
    const long = fitSms(`${"a".repeat(150)} {name}`, { name: "Sipho" }, " Opt out: x.test/o/abc");
    expect(long).toEqual({ text: `${"a".repeat(150)} Sipho`, optOutIncluded: false });
  });

  it("shortens long names and reasons, never amounts or links", () => {
    const template = "We couldn't verify your payment of R{amount}: {reason}. Please contact {agent_name} on {agent_phone}. {link}";
    const { text } = fitSms(template, { amount: "12 500,00", reason: "x".repeat(120), agent_name: "Thabo", agent_phone: "0825550123", link: "k.test/r/1" }, null);
    expect(gsmLength(text)).toBeLessThanOrEqual(160);
    expect(text).toContain("R12 500,00");
    expect(text).toContain("k.test/r/1");
    expect(text).toMatch(/: x+\. Please/);
    // Cut on a word where possible
    const words = fitSms("Sorry: {reason}. {link}", { reason: "the amount on the proof does not match what reflects in our account ".repeat(3), link: "k.test" }, null).text;
    expect(words).toMatch(/ [a-z]+\. k\.test$/);
    expect(gsmLength(words)).toBeLessThanOrEqual(160);
  });

  it("formats money for message wording", () => {
    expect(messageMoney(850000)).toBe("8 500,00");
    expect(messageBalance(-50000)).toBe("0,00 (R500,00 in credit)");
    expect(messageBalance(0)).toBe("0,00");
  });

  it("normalises phone numbers for the gateway", () => {
    expect(toMsisdn("082 123 4567")).toBe("27821234567");
    expect(toMsisdn("+27 (82) 123-4567")).toBe("27821234567");
    expect(toMsisdn("0027821234567")).toBe("27821234567");
    expect(toMsisdn("+44 7700 900123")).toBe("447700900123");
    expect(toMsisdn("082 123")).toBeNull();
    expect(toMsisdn("+27 82 123 45678")).toBeNull();
    expect(toMsisdn(null)).toBeNull();
  });

  it("escapes email content and links URLs", () => {
    const { html, text } = renderEmail(
      { agencyName: "A & B <Rentals>", colour: "#123456", logoUrl: null, footer: ["A & B (Pty) Ltd", "FFC 123"] },
      "Hi <b>Sam</b>,\n\nSee https://a.test/r/KL-R1.",
      "https://a.test/o/abc",
    );
    expect(html).toContain("Hi &lt;b&gt;Sam&lt;/b&gt;,");
    expect(html).toContain('<a href="https://a.test/r/KL-R1" style="color:inherit">https://a.test/r/KL-R1</a>.');
    expect(html).toContain("A &amp; B &lt;Rentals&gt;");
    expect(html).toContain('href="https://a.test/o/abc"');
    expect(text).toContain("Stop these emails: https://a.test/o/abc");
  });

  it("sends as the agency via the platform address", () => {
    expect(fromAddress("Kgosi Letting", "AWDRent <no-reply@awdrent.co.za>")).toBe('"Kgosi Letting via AWDRent" <no-reply@awdrent.co.za>');
    expect(fromAddress('Evil" <x@y>', "no-reply@awdrent.co.za")).toBe('"Evil x@y via AWDRent" <no-reply@awdrent.co.za>');
  });
});

describe("quiet hours (SAST = UTC+2)", () => {
  const at = (iso: string) => new Date(iso);
  it("waits until the end of an overnight window", () => {
    // 21:30 SAST → 07:00 next day
    expect(outsideQuietHours(at("2026-10-08T19:30:00Z"), "20:00:00", "07:00:00").toISOString()).toBe("2026-10-09T05:00:00.000Z");
    // 03:00 SAST → 07:00 the same day
    expect(outsideQuietHours(at("2026-10-08T01:00:00Z"), "20:00", "07:00").toISOString()).toBe("2026-10-08T05:00:00.000Z");
    // Month end
    expect(outsideQuietHours(at("2026-10-31T20:00:00Z"), "20:00", "07:00").toISOString()).toBe("2026-11-01T05:00:00.000Z");
  });

  it("sends straight away outside the window, or when there is none", () => {
    const noon = at("2026-10-08T10:00:00Z");
    expect(outsideQuietHours(noon, "20:00", "07:00")).toBe(noon);
    expect(outsideQuietHours(at("2026-10-08T05:00:00Z"), "20:00", "07:00").toISOString()).toBe("2026-10-08T05:00:00.000Z");
    expect(outsideQuietHours(at("2026-10-08T21:00:00Z"), "00:00", "00:00").toISOString()).toBe("2026-10-08T21:00:00.000Z");
  });

  it("handles a daytime window", () => {
    // 13:00 SAST inside 12:00–14:00 → 14:00
    expect(outsideQuietHours(at("2026-10-08T11:00:00Z"), "12:00", "14:00").toISOString()).toBe("2026-10-08T12:00:00.000Z");
  });
});

describe("webhook verification", () => {
  const secretBytes = Buffer.from("a-test-secret-of-some-length-123");
  const secret = `whsec_${secretBytes.toString("base64")}`;
  const sign = (id: string, ts: string, body: string) => createHmac("sha256", secretBytes).update(`${id}.${ts}.${body}`).digest("base64");
  const now = 1_790_000_000_000;
  const ts = String(now / 1000);
  const body = '{"type":"email.delivered","data":{"email_id":"abc"}}';

  it("accepts a correctly signed, fresh Resend event", () => {
    expect(verifySvix(secret, { id: "msg_1", timestamp: ts, signature: `v1,${sign("msg_1", ts, body)}` }, body, now)).toBe(true);
    // Rotated secrets send several signatures
    expect(verifySvix(secret, { id: "msg_1", timestamp: ts, signature: `v1,bm9wZQ== v1,${sign("msg_1", ts, body)}` }, body, now)).toBe(true);
  });

  it("rejects tampered, stale or unsigned events", () => {
    const sig = `v1,${sign("msg_1", ts, body)}`;
    expect(verifySvix(secret, { id: "msg_1", timestamp: ts, signature: sig }, body.replace("abc", "abd"), now)).toBe(false);
    expect(verifySvix(secret, { id: "msg_2", timestamp: ts, signature: sig }, body, now)).toBe(false);
    expect(verifySvix(secret, { id: "msg_1", timestamp: ts, signature: sig }, body, now + 10 * 60_000)).toBe(false);
    expect(verifySvix(secret, { id: "msg_1", timestamp: ts, signature: null }, body, now)).toBe(false);
    expect(verifySvix("whsec_", { id: "msg_1", timestamp: ts, signature: sig }, body, now)).toBe(false);
  });

  it("checks Clickatell's basic auth", () => {
    const header = `Basic ${Buffer.from("awd:s3cret").toString("base64")}`;
    expect(verifyBasicAuth(header, "awd", "s3cret")).toBe(true);
    expect(verifyBasicAuth(header, "awd", "other")).toBe(false);
    expect(verifyBasicAuth(header, undefined, undefined)).toBe(false);
    expect(verifyBasicAuth(null, "awd", "s3cret")).toBe(false);
  });

  it("maps provider statuses", () => {
    expect(resendStatus("email.delivered")).toBe("delivered");
    expect(resendStatus("email.bounced")).toBe("failed");
    expect(resendStatus("email.clicked")).toBeNull();
    expect(clickatellStatus("004", null)).toBe("delivered");
    expect(clickatellStatus(7, null)).toBe("failed");
    expect(clickatellStatus(null, "DELIVERED_TO_GATEWAY")).toBe("sent");
    expect(clickatellStatus("002", "QUEUED")).toBeNull();
  });

  it("never moves a message backwards", () => {
    expect(advancesStatus("sent", "delivered")).toBe(true);
    expect(advancesStatus("delivered", "sent")).toBe(false);
    expect(advancesStatus("delivered", "failed")).toBe(false);
    expect(advancesStatus("sent", "failed")).toBe(true);
    expect(advancesStatus("failed", "delivered")).toBe(false);
  });
});
