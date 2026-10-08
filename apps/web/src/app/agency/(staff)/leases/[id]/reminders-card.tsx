import { todayInSouthAfrica } from "@awdrent/core/billing";
import { remindersPaused } from "@awdrent/core/notices";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PauseRemindersForm } from "./reminder-forms";
import { resumeRemindersAction } from "./reminder-actions";

const day = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeZone: "Africa/Johannesburg" });

/** Rent reminders and overdue escalation for a live lease, with the pause (spec; D73). */
export function RemindersCard({
  lease,
  canPause,
}: {
  lease: { id: string; remindersPausedAt: Date | null; remindersPausedUntil: string | null; remindersPauseReason: string | null };
  canPause: boolean;
}) {
  const today = todayInSouthAfrica();
  const paused = remindersPaused(lease, today);
  return (
    <Card id="reminders">
      <CardHeader>
        <CardTitle>Reminders</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        <p className="text-muted-foreground">
          The tenant is reminded 5 days before rent is due and on the due day if unpaid. Overdue rent is followed up after 1 and 7 days (the
          agent gets a copy), and after 14 days agents and admins are alerted. Messages stop once the arrears are paid, and wait while a
          proof of payment is being checked.
        </p>
        {paused ? (
          <div className="grid gap-2 rounded-md border p-3" data-testid="reminders-paused">
            <p>
              <span className="font-medium">Overdue messages paused</span> since {day.format(lease.remindersPausedAt!)}
              {lease.remindersPausedUntil ? ` until ${day.format(new Date(`${lease.remindersPausedUntil}T00:00:00Z`))}` : ""}:{" "}
              {lease.remindersPauseReason}
            </p>
            {canPause ? (
              <form action={resumeRemindersAction.bind(null, lease.id)}>
                <Button type="submit" size="sm" variant="outline">
                  Resume overdue messages
                </Button>
              </form>
            ) : null}
          </div>
        ) : canPause ? (
          <PauseRemindersForm leaseId={lease.id} today={today} />
        ) : null}
      </CardContent>
    </Card>
  );
}
