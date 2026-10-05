import { redirect } from "next/navigation";

// API keys now live on the Accounts & AI page.
export default function KeysPage() {
  redirect("/beta/accounts#keys");
}
