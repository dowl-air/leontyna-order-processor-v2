import { feedsDownload } from "@/actions/feedsDownload";
import { sendOrders } from "@/actions/triggerOrdersSend";

export const dynamic = "force-dynamic";

export const GET = async () => {
    try {
        await feedsDownload();
        await sendOrders();
        return Response.json({ message: "Feeds downloaded and orders sent." });
    } catch (e) {
        console.log('Error, something went wrong.', e);
        return Response.error();
    }
};