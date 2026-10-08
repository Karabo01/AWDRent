import { toNextJsHandler } from "better-auth/next-js";
import { staffAuth } from "@/server/auth/staff";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return toNextJsHandler(staffAuth()).GET(request);
}
export async function POST(request: Request) {
  return toNextJsHandler(staffAuth()).POST(request);
}
