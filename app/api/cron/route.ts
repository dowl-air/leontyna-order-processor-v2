import { feedsDownload } from "@/actions/feedsDownload";
import { sendOrders } from "@/actions/triggerOrdersSend";
import { updateAggregatedOrdersState, updateNewOrdersState } from "@/actions/updateOrdersState";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

export const GET = async () => {
    try {
        const headersList = headers();
        const auth = headersList.get("Authorization");
        if (auth !== `Bearer ${process.env.CRON_SECRET}`) return Response.error();
        await feedsDownload();
        await sendOrders();
        await updateNewOrdersState();
        await updateAggregatedOrdersState();
        return Response.json({ message: "Feeds downloaded, orders sent and products updated." });
    } catch (e) {
        console.log("Error, something went wrong.", e);
        return Response.error();
    }
};
