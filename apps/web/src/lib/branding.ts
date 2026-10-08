/** URL of an agency's logo on its own host; the key's file name busts caches when the logo changes. */
export function logoSrc(agency: { logo_key: string | null }): string | undefined {
  return agency.logo_key ? `/branding/logo?v=${agency.logo_key.split("/").pop()}` : undefined;
}
