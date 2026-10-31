import { feedsDownload } from "@/actions/feedsDownload";
import { sendOrders } from "@/actions/triggerOrdersSend";
import { updateAggregatedOrdersState, updateNewOrdersState } from "@/actions/updateOrdersState";
import { getCronPlan } from "@/utils/cronPlan";
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

    // Kontri request spacing is enforced by the shared limiter, so steps run back to back without fixed pauses.
    const plan = getCronPlan(new Date());
    const feeds = await runStep(feedsDownload, "feeds");
    const submission =
        feeds.status === "success"
            ? await runStep(() => sendOrders({ checkUnconfirmed: plan.checks }), "sendOrders")
            : { status: "skipped", message: "Order submission skipped because the import did not succeed." };
    const newOrders = plan.checks
        ? await runStep(() => updateNewOrdersState({ fullSweep: plan.fullSweep }), "newOrders")
        : { status: "skipped", message: "New-order status checks run only in the 30-minute slots." };
    const aggregatedOrders = plan.fullSweep
        ? await runStep(updateAggregatedOrdersState, "aggregatedOrders")
        : { status: "skipped", message: "Aggregated-order status checks run only in the three-hourly full sweep." };
    const results = { feeds, sendOrders: submission, newOrders, aggregatedOrders };
    const failed = feeds.status !== "success" || Object.values(results).some((result) => result.status === "error");
    return Response.json(
        {
            status: failed ? "error" : "success",
            message: failed ? "Cron completed with failed steps; inspect results." : "Cron completed successfully.",
            plan,
            results,
        },
        { status: failed ? 500 : 200 },
    );
};
