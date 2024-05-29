"use server";

import { addProduct } from "@/db/addProduct";
import { getLatestDate } from "@/db/getLatestDate";
import { formatDateShoptet } from "@/utils/formatDate";

let csv = require("csvtojson");
let request = require("request");

const SHOPTET_URL = process.env.SHOPTET_URL!;
const SHOPTET_URL_SK = process.env.SHOPTET_URL_SK!;

export const feedsDownload = async () => {
    console.log("Fetching data from SHOPTET started.");

    const date = await getLatestDate();
    console.log("Latest date in the database: ", date.toLocaleString());
    const dateFormatted = formatDateShoptet(date);

    const fetchAndProcessCSV = (url: string) => {
        return new Promise((resolve, reject) => {
            csv()
                .fromStream(request.get(`${url}&updateTimeFrom=${dateFormatted}`))
                .subscribe(
                    (json: any) => {
                        return new Promise((resolve, reject) => {
                            if (!json) return resolve({});
                            if (json.hasOwnProperty("orderItemType") && json.orderItemType !== "product") return resolve({});
                            if (json.hasOwnProperty("orderItemSupplier") && json.orderItemSupplier !== "Kontri.pl") return resolve({});
                            if (json.hasOwnProperty("field13")) delete json.field13;

                            addProduct(json)
                                .then(() => resolve({}))
                                .catch((err: any) => {
                                    console.error(err);
                                    resolve({});
                                });
                        });
                    },
                    (error: any) => {
                        console.error(error);
                        reject(error);
                    },
                    () => {
                        console.log(`Data from ${url} fetched successfully.`);
                        resolve({});
                    }
                );
        });
    };

    try {
        await Promise.all([fetchAndProcessCSV(SHOPTET_URL), fetchAndProcessCSV(SHOPTET_URL_SK)]);
        return { message: "Data ze SHOPTET CZ&SK úspěšně staženy." };
    } catch (error) {
        return { message: "An error occurred while fetching data from SHOPTET." };
    }
};
