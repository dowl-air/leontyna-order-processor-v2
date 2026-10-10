import { feedsDownload } from "@/actions/feedsDownload";
import { sendOrders } from "@/actions/triggerOrdersSend";
import { updateAggregatedOrdersState, updateNewOrdersState } from "@/actions/updateOrdersState";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

type StepResult = { status: string; message: string; checkedCount?: number; failedCount?: number };

const runStep = async (operation: () => Promise<StepResult>, name: string): Promise<StepResult> => {
    try {
        const result = await operation();
        if (!result || !["success", "info", "error"].includes(result.status) || typeof result.message !== "string")
            throw new Error("Invalid cron step result.");
        return result;
    } catch {
        return { status: "error", message: `Cron step ${name} failed.` };
    }
};

export const GET = async () => {
    const auth = headers().get("Authorization");
    if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`)
        return Response.json({ status: "error", message: "Unauthorized." }, { status: 401 });

    const feeds = await runStep(feedsDownload, "feeds");
    const submission =
        feeds.status === "success"
            ? await runStep(sendOrders, "sendOrders")
            : { status: "skipped", message: "Order submission skipped because the import did not succeed." };
    const newOrders = await runStep(updateNewOrdersState, "newOrders");
    const aggregatedOrders = await runStep(updateAggregatedOrdersState, "aggregatedOrders");
    const results = { feeds, sendOrders: submission, newOrders, aggregatedOrders };
    const failed = feeds.status !== "success" || Object.values(results).some((result) => result.status === "error");
    return Response.json(
        {
            status: failed ? "error" : "success",
            message: failed ? "Cron completed with failed steps; inspect results." : "Cron completed successfully.",
            results,
        },
        { status: failed ? 500 : 200 },
    );
};
