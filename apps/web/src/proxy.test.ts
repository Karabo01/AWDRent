import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";
import { proxy } from "./proxy";

beforeAll(() => {
  process.env.APP_BASE_DOMAIN = "awdrent.co.za";
});

function run(host: string, path: string) {
  const req = new NextRequest(`https://${host}${path}`, { headers: { host } });
  const res = proxy(req);
  return { status: res.status, rewrite: res.headers.get("x-middleware-rewrite") };
}

describe("proxy host routing", () => {
  it("rewrites agency hosts into the agency tree", () => {
    expect(run("kl.awdrent.co.za", "/owners?page=2").rewrite).toBe("https://kl.awdrent.co.za/agency/owners?page=2");
    expect(run("kl.awdrent.co.za", "/").rewrite).toBe("https://kl.awdrent.co.za/agency");
  });

  it("rewrites the admin host into the platform tree", () => {
    expect(run("admin.awdrent.co.za", "/agencies").rewrite).toBe("https://admin.awdrent.co.za/platform/agencies");
  });

  it("404s unknown hosts and direct requests for internal prefixes", () => {
    expect(run("evil.com", "/").status).toBe(404);
    expect(run("kl.awdrent.co.za", "/platform").status).toBe(404);
    expect(run("kl.awdrent.co.za", "/agency/owners").status).toBe(404);
    expect(run("admin.awdrent.co.za", "/agency").status).toBe(404);
  });

  it("serves each auth API only on its own kind of host", () => {
    expect(run("kl.awdrent.co.za", "/api/auth/sign-in/email").rewrite).toBeNull();
    expect(run("kl.awdrent.co.za", "/api/auth/sign-in/email").status).toBe(200);
    expect(run("admin.awdrent.co.za", "/api/auth/sign-in/email").status).toBe(404);
    expect(run("kl.awdrent.co.za", "/api/platform-auth/sign-in/email").status).toBe(404);
    expect(run("admin.awdrent.co.za", "/api/platform-auth/sign-in/email").status).toBe(200);
  });
});
