import { downloadKontriFeed } from "@/actions/downloadKontriFeed";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

export const GET = async () => {
    const auth = headers().get("Authorization");
    if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`)
        return Response.json({ status: "error", message: "Unauthorized." }, { status: 401 });

    const localTime = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Prague",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).formatToParts(new Date());
    if (localTime.find((part) => part.type === "hour")?.value !== "05" || localTime.find((part) => part.type === "minute")?.value !== "55")
        return Response.json({ status: "skipped", message: "Kontri feed runs at 05:55 Europe/Prague." });

    try {
        const result = await downloadKontriFeed();
        if (!result || !["success", "info", "error"].includes(result.status) || typeof result.message !== "string")
            throw new Error("Invalid Kontri feed result.");
        return Response.json({ status: result.status, results: { kontriFeed: result } }, { status: result.status === "error" ? 500 : 200 });
    } catch {
        return Response.json({ status: "error", message: "Kontri feed cron failed." }, { status: 500 });
    }
};
