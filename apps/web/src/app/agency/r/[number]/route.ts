import { agencyOrigin } from "@awdrent/core/hosts";
import { receiptLeaseId } from "@awdrent/core/receipts";
import { NextResponse } from "next/server";
import { actorOf } from "@/server/actor";
import { currentAgency, optionalStaffSession } from "@/server/session";

export const dynamic = "force-dynamic";

/**
 * The short receipt link in payment SMSes (/r/KL-R000123). The link holds
 * no secret: staff go to the lease's account; tenants sign in to the portal
 * and get the receipt.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ number: string }> }) {
  const agency = await currentAgency();
  const origin = agencyOrigin(agency.subdomain);
  const { number } = await params;
  if (!/^[A-Z]{2,4}-R\d{6,}$/.test(number)) return new NextResponse("Not found", { status: 404 });
  const staff = await optionalStaffSession();
  if (staff?.twoFactorEnabled) {
    const leaseId = await receiptLeaseId(actorOf(staff.session), number).catch(() => null);
    if (leaseId) return NextResponse.redirect(`${origin}/leases/${leaseId}#account`);
  }
  // Tenants: the receipt itself, after portal sign-in
  return NextResponse.redirect(`${origin}/p/receipts/${encodeURIComponent(number)}`);
}
