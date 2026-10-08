import { toNextJsHandler } from "better-auth/next-js";
import { portalAuth } from "@/server/auth/portal";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return toNextJsHandler(portalAuth()).GET(request);
}
export async function POST(request: Request) {
  return toNextJsHandler(portalAuth()).POST(request);
}
