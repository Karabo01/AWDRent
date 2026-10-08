import { getAgencySettings } from "@awdrent/core/agency-settings";
import { mask } from "@awdrent/core/crypto";
import { PageHeader } from "@/components/shell/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCan } from "@/server/session";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { ctx } = await requireCan("settings.manage");
  const s = await getAgencySettings({ ...ctx, readOnly: true });
  return (
    <>
      <PageHeader title="Agency settings" description={`${s.subdomain}.awdrent.co.za · EFT references start with ${s.eftPrefix}-`} />
      <div className="grid max-w-2xl gap-6">
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
              }}
            />
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
