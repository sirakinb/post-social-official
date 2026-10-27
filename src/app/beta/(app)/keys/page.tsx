import { redirect } from "next/navigation";

// API keys now live on the Connect your AI page (/beta/api).
export default function KeysPage() {
  redirect("/beta/api#keys");
}
