import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/auth-card";
import { LoginForm } from "@/components/auth/login-form";
import { optionalPlatformSession } from "@/server/session";

export const metadata = { title: "Sign in" };

export default async function PlatformLoginPage() {
  if (await optionalPlatformSession()) redirect("/");
  return (
    <AuthCard brand="AWDRent Platform" title="Sign in" description="AWDTECH staff only">
      <LoginForm audience="platform" />
    </AuthCard>
  );
}
