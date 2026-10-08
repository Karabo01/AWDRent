"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { authClient, type AuthAudience } from "@/lib/auth-client";

export function SignOutButton({ audience }: { audience: AuthAudience }) {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={async () => {
        await authClient(audience).signOut();
        router.replace("/login");
        router.refresh();
      }}
    >
      Sign out
    </Button>
  );
}
