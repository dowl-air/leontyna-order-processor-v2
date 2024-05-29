"use server";

import { CheckStatusResponse } from "@/types/api/CheckStatusResponse";
import { checkService } from "@/utils/soapClient";

export const checkServiceStatus = async (): Promise<CheckStatusResponse> => {
    try {
        const res = await checkService()
        if (res === null) {
            return { CheckStatusResult: "Service is not available." };
        }
        else {
            return res as CheckStatusResponse;
        }
    } catch (error) {
        console.error(error);
        return {CheckStatusResult: "Error checking service status."};
    }
};
