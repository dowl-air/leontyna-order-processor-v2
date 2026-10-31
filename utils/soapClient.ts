"use server";
import { createClient, BasicAuthSecurity, Client } from "soap";
import { withKontriSpacing } from "./kontriThrottle";

const url = "https://api.kontri.pl:8866/KontriAPIservice.svc?wsdl";
const username = process.env.KONTRI_API_USER!;
const password = process.env.KONTRI_API_PASSWORD!;

let clientPromise: Promise<Client> | null = null;

function createClient_(): Promise<Client> {
    return new Promise((resolve, reject) => {
        const options = {
            wsdl_headers: {
                Authorization: "Basic " + Buffer.from(username + ":" + password).toString("base64"),
            },
        };
        createClient(url, options, (err, client) => {
            if (err) {
                return reject(err);
            }
            client.setSecurity(new BasicAuthSecurity(username, password));
            resolve(client);
        });
    });
}

// The WSDL download is a Kontri request too, so it is loaded once per instance and spaced like other calls.
function getClient(): Promise<Client> {
    if (!clientPromise) {
        clientPromise = withKontriSpacing(createClient_);
        clientPromise.catch(() => {
            clientPromise = null;
        });
    }
    return clientPromise;
}

async function call(method: string, args: object): Promise<any> {
    const client = await getClient();
    return withKontriSpacing(
        () =>
            new Promise((resolve, reject) => {
                client[method](args, (err: any, result: any) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve(result);
                });
            }),
    );
}

export async function checkService(): Promise<any> {
    return call("CheckStatus", {});
}

export async function getOrderStatus(altumOrderID: string) {
    return call("GetOrderStatus", { AltumOrderID: altumOrderID });
}

export async function getOrderStatusByRefNumber(RefNumber: string) {
    return call("GetOrderStatusByRefNumber", { RefNumber });
}
