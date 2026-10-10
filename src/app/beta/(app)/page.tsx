import { redirect } from "next/navigation";

// The app opens on Accounts; there is no separate Home page.
export default function BetaHome() {
  redirect("/beta/accounts");
}
