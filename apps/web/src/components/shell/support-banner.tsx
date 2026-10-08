import type { SupportInfo } from "@/server/session";

const time = new Intl.DateTimeFormat("en-ZA", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Johannesburg" });

/** Shown on every page while AWDTECH support is acting in an agency. */
export function SupportBanner({ support }: { support: SupportInfo }) {
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-2 bg-amber-100 px-4 py-2 text-sm text-amber-950">
      <span>
        <strong>AWDTECH support session</strong> · {support.adminName} ·{" "}
        {support.writeAccess ? "write access enabled" : "read-only"} · ends {time.format(support.expiresAt)} · every page view is logged
      </span>
      <form action="/support/exit" method="post">
        <button type="submit" className="underline">
          Leave session
        </button>
      </form>
    </div>
  );
}
