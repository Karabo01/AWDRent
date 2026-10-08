import type { Metadata } from "next";
import { currentAgency } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  const agency = await currentAgency();
  return { title: { default: agency.name, template: `%s · ${agency.name}` } };
}

/** Applies the agency's brand colour to everything under its host. */
export default async function AgencyLayout({ children }: { children: React.ReactNode }) {
  const agency = await currentAgency();
  // brand_colour is constrained to #rrggbb in the database
  return <div style={{ "--brand": agency.brand_colour } as React.CSSProperties}>{children}</div>;
}
