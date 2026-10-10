"use server";

import { addProduct } from "@/db/addProduct";
import { getLatestDate } from "@/db/getLatestDate";
import { formatDateShoptet } from "@/utils/formatDate";
import csv from "csvtojson";
import { Readable } from "node:stream";

const SHOPTET_URL = process.env.SHOPTET_URL!;
const SHOPTET_URL_SK = process.env.SHOPTET_URL_SK!;

export const feedsDownload = async () => {
    console.log("Fetching data from SHOPTET started.");

    const date = await getLatestDate();
    console.log("Latest date in the database: ", date.toLocaleString());
    const dateFormatted = formatDateShoptet(date);

    const fetchAndProcessCSV = async (url: string) => {
        const response = await fetch(`${url}&updateTimeFrom=${dateFormatted}`, { cache: "no-store" });
        if (!response.ok || !response.body) throw new Error("Shoptet feed download failed.");
        const stream = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
        return new Promise<void>((resolve, reject) => {
            stream.once("error", reject);
            csv()
                .fromStream(stream)
                .subscribe(
                    (json: any) => {
                        return new Promise<void>((resolve) => {
                            if (!json) return resolve();
                            if (json.hasOwnProperty("orderItemType") && json.orderItemType !== "product") return resolve();
                            if (json.hasOwnProperty("orderItemCode") && json.orderItemCode.substring(0, 2) !== "AK") return resolve();
                            if (json.hasOwnProperty("orderItemSupplier") && json.orderItemSupplier !== "Kontri.pl") return resolve();
                            if (json.hasOwnProperty("field13")) delete json.field13;

                            addProduct(json)
                                .then(() => resolve())
                                .catch((err: any) => {
                                    console.error(err);
                                    resolve();
                                });
                        });
                    },
                    (error: any) => {
                        console.error(error);
                        reject(error);
                    },
                    () => {
                        console.log(`Data from ${url} fetched successfully.`);
                        resolve();
                    },
                );
        });
    };

    try {
        await Promise.all([fetchAndProcessCSV(SHOPTET_URL), fetchAndProcessCSV(SHOPTET_URL_SK)]);
        return { status: "success", message: "Data ze SHOPTET CZ&SK úspěšně staženy." };
    } catch (error) {
        return { status: "error", message: "An error occurred while fetching data from SHOPTET." };
    }
};
