import { checkService } from "@/utils/soapClient";
import { NextApiRequest, NextApiResponse } from "next";

export const GET = async () => {
    try {
        const result = await checkService();
        return Response.json(result);
    } catch (e) {
        console.log('Error, something went wrong.', e);
        return Response.error();
    }
};