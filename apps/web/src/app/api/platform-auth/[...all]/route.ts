import { toNextJsHandler } from "better-auth/next-js";
import { platformAuth } from "@/server/auth/platform";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return toNextJsHandler(platformAuth()).GET(request);
}
export async function POST(request: Request) {
  return toNextJsHandler(platformAuth()).POST(request);
}
