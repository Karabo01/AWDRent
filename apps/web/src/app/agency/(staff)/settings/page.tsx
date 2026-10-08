import { getAgencySettings } from "@awdrent/core/agency-settings";
import { mask } from "@awdrent/core/crypto";
import Link from "next/link";
import { PageHeader } from "@/components/shell/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCan } from "@/server/session";
import { Button } from "@/components/ui/button";
import { logoSrc } from "@/lib/branding";
import { removeLogoAction } from "./actions";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ logo?: string }> }) {
  const { ctx, agency } = await requireCan("settings.manage");
  const { logo } = await searchParams;
  const src = logoSrc(agency);
  const s = await getAgencySettings({ ...ctx, readOnly: true });
  return (
    <>
      <PageHeader title="Agency settings" description={`${s.subdomain}.awdrent.co.za · EFT references start with ${s.eftPrefix}-`} />
      <div className="grid max-w-2xl gap-6">
        <Card id="logo">
          <CardHeader>
            <CardTitle>Logo</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <p className="text-sm text-muted-foreground">
              Shown to tenants, owners and applicants: sign-in pages, the portal, emails, statements, receipts and leases.
            </p>
            {logo ? (
              logo === "ok" ? (
                <p role="status" className="text-sm text-green-700">
                  Uploaded. It appears once the virus check finishes, usually within a minute.
                </p>
              ) : (
                <p role="alert" className="text-sm text-destructive">
                  {logo}
                </p>
              )
            ) : null}
            {src ? (
              <div className="flex items-center gap-4">
                <img src={src} alt={`${s.name} logo`} className="h-16 max-w-48 object-contain" data-testid="agency-logo" />
                <form action={removeLogoAction}>
                  <Button type="submit" variant="ghost" size="sm">
                    Remove
                  </Button>
                </form>
              </div>
            ) : (
              <p className="text-sm">No logo yet; your agency name is shown instead.</p>
            )}
            <form action="/settings/logo" method="post" encType="multipart/form-data" className="flex flex-wrap items-end gap-3">
              <label className="grid gap-1.5 text-sm">
                PNG or JPG, up to 1 MB. A wide logo on a transparent or white background works best.
                <input type="file" name="logo" accept="image/png,image/jpeg" required className="text-sm" />
              </label>
              <Button type="submit" variant="outline">
                Upload logo
              </Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Branding, trust account and messaging</CardTitle>
          </CardHeader>
          <CardContent>
            <SettingsForm
              values={{
                name: s.name,
                brandColour: s.brandColour,
                trustBankName: s.trustBankName ?? "",
                trustAccountMasked: mask(s.trustAccountNoLast4),
                quietHoursStart: s.quietHoursStart,
                quietHoursEnd: s.quietHoursEnd,
                legalName: s.legalName,
                registrationNo: s.registrationNo,
                ffcNumber: s.ffcNumber,
                vatNumber: s.vatNumber,
                physicalAddress: s.physicalAddress,
                contactPhone: s.contactPhone,
                contactEmail: s.contactEmail,
              }}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Message wording</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <p className="text-muted-foreground">Reminders, payment confirmations and other messages tenants receive by email and SMS.</p>
            <Link href="/settings/messages" className="underline">
              Edit message wording
            </Link>
          </CardContent>
        </Card>
        <p className="text-sm text-muted-foreground">
          Plan: {s.plan}. SMS sender ID: {s.smsSenderName ?? "default"}. To change your plan, address, EFT prefix or SMS
          sender ID, contact AWDTECH.
        </p>
      </div>
    </>
  );
}
