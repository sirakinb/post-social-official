import { redirect } from "next/navigation";

// API keys now live on the API/MCP page.
export default function KeysPage() {
  redirect("/beta/api#keys");
}
