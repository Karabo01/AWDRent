import { describe, expect, it } from "vitest";
import { assertDownloadable, cleanKeyFor, newQuarantineKey, parseKey, StorageAccessError } from "./storage";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("storage keys", () => {
  it("puts new uploads in the agency's quarantine area", () => {
    const key = newQuarantineKey(A, "pdf");
    expect(key).toMatch(new RegExp(`^agencies/${A}/quarantine/[0-9a-f-]{36}\\.pdf$`));
    expect(parseKey(key)).toMatchObject({ agencyId: A, area: "quarantine" });
  });

  it("maps a quarantine key to its clean location", () => {
    const key = newQuarantineKey(A, "png");
    expect(cleanKeyFor(key)).toBe(key.replace("quarantine", "files"));
  });

  it("allows downloading only scanned files of the same agency", () => {
    const clean = cleanKeyFor(newQuarantineKey(A, "pdf"));
    expect(() => assertDownloadable(clean, A)).not.toThrow();
    expect(() => assertDownloadable(clean, B)).toThrow(StorageAccessError);
    expect(() => assertDownloadable(newQuarantineKey(A, "pdf"), A)).toThrow(StorageAccessError);
  });

  it("rejects keys that try to escape the agency prefix", () => {
    for (const key of [
      `agencies/${A}/files/../../${B}/files/x.pdf`,
      `agencies/${B}/files/${A}.pdf/../x`,
      `/agencies/${A}/files/${A}.pdf`,
      `agencies/${A}/files/not-a-uuid.pdf`,
    ]) {
      expect(parseKey(key)).toBeNull();
      expect(() => assertDownloadable(key, A)).toThrow(StorageAccessError);
    }
  });
});
