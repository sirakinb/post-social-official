import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily(
  "refresh expiring social access",
  { hourUTC: 8, minuteUTC: 15 },
  internal.tokenLifecycle.refreshExpiring
);

crons.daily(
  "remove expired deletion receipts",
  { hourUTC: 9, minuteUTC: 15 },
  internal.metaDeletion.purgeExpiredReceipts
);

crons.daily(
  "remove expired security records",
  { hourUTC: 9, minuteUTC: 45 },
  internal.maintenance.purgeExpiredEphemera
);

crons.interval(
  "recover interrupted publishing",
  { minutes: 1 },
  internal.publishing.recoverExpiredLeases
);

export default crons;
