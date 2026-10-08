import { createServer } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseReply, scanBuffer } from "./clamav";
import { cleanFilename, detectFileType } from "./file-types";

describe("detectFileType", () => {
  it("recognises PDF, JPEG and PNG by their bytes", () => {
    expect(detectFileType(Buffer.from("%PDF-1.7 ..."))?.extension).toBe("pdf");
    expect(detectFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))?.extension).toBe("jpg");
    expect(detectFileType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))?.extension).toBe("png");
  });

  it("refuses anything else, whatever it is called", () => {
    expect(detectFileType(Buffer.from("MZ\x90\x00 windows exe"))).toBeNull();
    expect(detectFileType(Buffer.from("<html><script>"))).toBeNull();
    expect(detectFileType(Buffer.from(""))).toBeNull();
  });
});

describe("cleanFilename", () => {
  it("strips paths and odd characters and uses the detected extension", () => {
    expect(cleanFilename("C:\\Users\\x\\Lease 2026.PDF", "pdf")).toBe("Lease 2026.pdf");
    expect(cleanFilename("../../etc/passwd", "png")).toBe("passwd.png");
    expect(cleanFilename('evil"name<>.exe', "pdf")).toBe("evilname.pdf");
    expect(cleanFilename("", "jpg")).toBe("document.jpg");
  });
});

describe("clamd client", () => {
  // A fake clamd that reads the INSTREAM framing and flags the EICAR string
  let port = 0;
  const server = createServer((socket) => {
    const parts: Buffer[] = [];
    socket.on("data", (d) => {
      parts.push(d);
      const all = Buffer.concat(parts);
      if (all.length >= 14 && all.subarray(all.length - 4).readUInt32BE() === 0) {
        let offset = "zINSTREAM\0".length;
        const body: Buffer[] = [];
        for (;;) {
          const len = all.readUInt32BE(offset);
          offset += 4;
          if (len === 0) break;
          body.push(all.subarray(offset, offset + len));
          offset += len;
        }
        const infected = Buffer.concat(body).toString("latin1").includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE");
        socket.end(infected ? "stream: Win.Test.EICAR_HDB-1 FOUND\0" : "stream: OK\0");
      }
    });
  });
  beforeAll(
    () =>
      new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", () => {
          port = (server.address() as { port: number }).port;
          resolve();
        }),
      ),
  );
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("streams the file and reports clean", async () => {
    expect(await scanBuffer(Buffer.alloc(200_000, 7), { host: "127.0.0.1", port })).toEqual({ clean: true });
  });

  it("reports the signature for an infected file", async () => {
    const eicar = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
    expect(await scanBuffer(Buffer.from(eicar), { host: "127.0.0.1", port })).toEqual({
      clean: false,
      signature: "Win.Test.EICAR_HDB-1",
    });
  });

  it("treats errors as failures, never as clean", () => {
    expect(() => parseReply("INSTREAM size limit exceeded. ERROR\0")).toThrow(/clamd error/);
    expect(() => parseReply("")).toThrow();
  });
});
