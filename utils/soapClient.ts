import ShopOrder from '@/types/ShopOrder';
import { createClient, BasicAuthSecurity, Client } from 'soap';

const url = "https://api.kontri.pl:8866/KontriAPIservice.svc?wsdl";
const username = process.env.KONTRI_API_USER!;
const password = process.env.KONTRI_API_PASSWORD!;

export function createClient_(): Promise<Client> {
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

export async function checkService(): Promise<any> {
    const client = await createClient_();
    return new Promise((resolve, reject) => {
        client.CheckStatus({}, (err: any, result: any) => {
            if (err) {
                return reject(err);
            }
            resolve(result);
        });
    });
}

export async function getOrderStatus(altumOrderID: string) {
    const client = await createClient_();
    return new Promise((resolve, reject) => {
        client.GetOrderStatus({ AltumOrderID: altumOrderID }, (err: any, result: any) => {
            if (err) {
                return reject(err);
            }
            resolve(result);
        });
    });
}

export async function sendOrder(orderObject: any) {
    const client = await createClient_();
    return new Promise((resolve, reject) => {
        client.AddOrder({ Order: orderObject }, (err: any, result: any) => {
            if (err) {
                return reject(err);
            }
            resolve(result);
        });
    });
}
