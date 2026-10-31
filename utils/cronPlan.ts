export type CronPlan = { checks: boolean; fullSweep: boolean };

// The cron runs every 10 minutes; each slot covers a whole 10-minute window to tolerate delayed delivery.
// Kontri checks (unconfirmed orders and status 100) run at :00 and :30, full status sweeps every three hours
// (00:00, 03:00, ... Europe/Prague).
export function getCronPlan(now: Date): CronPlan {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Prague",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).formatToParts(now);
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    return {
        checks: minute % 30 < 10,
        fullSweep: hour % 3 === 0 && minute < 10,
    };
}
