import { listStaff } from "@awdrent/core/staff";
import Link from "next/link";
import { PageHeader } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { devEmailLink } from "@/server/dev-email";
import { requireCan } from "@/server/session";
import { resendStaffInviteAction } from "./actions";
import { InviteStaffForm } from "./staff-forms";

export const metadata = { title: "Staff" };

const ROLE: Record<string, string> = { admin: "Admin", agent: "Rental agent", accounts: "Accounts" };
const dateTime = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Johannesburg" });

export default async function StaffPage({ searchParams }: { searchParams: Promise<{ invited?: string }> }) {
  const { ctx } = await requireCan("staff.manage");
  const staff = await listStaff({ ...ctx, readOnly: true });
  const { invited } = await searchParams;
  const devLink = invited ? devEmailLink(invited) : null;
  return (
    <>
      <PageHeader title="Staff" description="Everyone who can sign in to your agency. Two-factor sign-in is required for all staff." />
      {invited ? (
        <p role="status" className="mb-4 rounded-md bg-green-50 p-3 text-sm text-green-900">
          Invite sent to {invited}. The link is valid for 72 hours.{" "}
          {devLink ? (
            <a href={devLink} className="underline" data-testid="dev-invite-link">
              Dev only: open invite link
            </a>
          ) : null}
        </p>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Last sign-in</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {staff.map((u) => (
            <TableRow key={u.id}>
              <TableCell>
                <Link href={`/staff/${u.id}`} className="font-medium hover:underline">
                  {u.name}
                </Link>
              </TableCell>
              <TableCell>{u.email}</TableCell>
              <TableCell>{ROLE[u.role]}</TableCell>
              <TableCell>
                {!u.active ? (
                  <Badge variant="outline">Deactivated</Badge>
                ) : !u.lastLoginAt ? (
                  <Badge variant="secondary">Invite pending</Badge>
                ) : !u.twoFactorEnabled ? (
                  <Badge variant="secondary">2FA not set up</Badge>
                ) : (
                  <Badge variant="secondary">Active</Badge>
                )}
              </TableCell>
              <TableCell>{u.lastLoginAt ? dateTime.format(u.lastLoginAt) : "—"}</TableCell>
              <TableCell className="text-right">
                {u.active && !u.lastLoginAt ? (
                  <form action={resendStaffInviteAction.bind(null, u.id)}>
                    <button type="submit" className="text-sm underline">
                      Resend invite
                    </button>
                  </form>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Card className="mt-8 max-w-xl">
        <CardHeader>
          <CardTitle>Invite a staff member</CardTitle>
        </CardHeader>
        <CardContent>
          <InviteStaffForm />
        </CardContent>
      </Card>
    </>
  );
}
