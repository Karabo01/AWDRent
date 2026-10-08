import { listProfiles } from "@awdrent/core/banking";
import { PageHeader } from "@/components/shell/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { actorOf, load } from "@/server/actor";
import { requireCan } from "@/server/session";
import { ProfileForm } from "../banking-forms";

export const metadata = { title: "Bank formats" };

export default async function ProfilesPage() {
  const s = await requireCan("payments.approve");
  const profiles = await load(() => listProfiles(actorOf(s)));
  return (
    <div className="grid max-w-2xl gap-6">
      <PageHeader title="Bank formats" description="How your bank lays out its CSV statement. Set this up once per bank account format." />
      {profiles.map((p) => (
        <Card key={p.id}>
          <CardHeader>
            <CardTitle>{p.name}</CardTitle>
          </CardHeader>
          <CardContent>
            <ProfileForm
              profileId={p.id}
              values={{
                name: p.name,
                dateColumn: p.dateColumn,
                amountMode: p.amountColumn ? "single" : "split",
                amountColumn: p.amountColumn ?? "",
                creditColumn: p.creditColumn ?? "",
                debitColumn: p.debitColumn ?? "",
                referenceColumn: p.referenceColumn,
                descriptionColumn: p.descriptionColumn ?? "",
                dateFormat: p.dateFormat,
                skipRows: p.skipRows,
              }}
            />
          </CardContent>
        </Card>
      ))}
      <Card>
        <CardHeader>
          <CardTitle>{profiles.length ? "Add another format" : "Your bank's format"}</CardTitle>
        </CardHeader>
        <CardContent>
          <ProfileForm profileId={null} />
        </CardContent>
      </Card>
    </div>
  );
}
