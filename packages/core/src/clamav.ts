import { Socket } from "node:net";

// Minimal clamd client using the INSTREAM command over TCP:
//   "zINSTREAM\0", then chunks of [4-byte big-endian length][bytes],
//   then a zero-length chunk. clamd replies "stream: OK" or
//   "stream: <signature> FOUND" (or an ERROR line).

export type ScanResult = { clean: true } | { clean: false; signature: string };

const CHUNK = 64 * 1024;

export async function scanBuffer(
  data: Uint8Array,
  opts: { host: string; port: number; timeoutMs?: number },
): Promise<ScanResult> {
  const reply = await new Promise<string>((resolve, reject) => {
    const socket = new Socket();
    const parts: Buffer[] = [];
    socket.setTimeout(opts.timeoutMs ?? 60_000);
    socket.on("timeout", () => socket.destroy(new Error("clamd timed out")));
    socket.on("error", reject);
    socket.on("data", (d) => parts.push(d));
    socket.on("end", () => resolve(Buffer.concat(parts).toString("utf8")));
    socket.connect(opts.port, opts.host, () => {
      socket.write("zINSTREAM\0");
      for (let i = 0; i < data.length; i += CHUNK) {
        const chunk = data.subarray(i, i + CHUNK);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(chunk.length);
        socket.write(len);
        socket.write(chunk);
      }
      socket.end(Buffer.alloc(4));
    });
  });
  return parseReply(reply);
}

export function parseReply(raw: string): ScanResult {
  const reply = raw.replace(/\0/g, "").trim();
  if (/^stream: OK$/.test(reply)) return { clean: true };
  const found = /^stream: (.+) FOUND$/.exec(reply);
  if (found) return { clean: false, signature: found[1]! };
  throw new Error(`clamd error: ${reply || "empty reply"}`);
}
