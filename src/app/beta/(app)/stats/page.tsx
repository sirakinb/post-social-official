import { redirect } from "next/navigation";

// The Stats page grew into Analytics; old links land there.
export default function OldStatsPage() {
  redirect("/beta/analytics");
}
