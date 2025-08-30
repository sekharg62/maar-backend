import { paytmConfig } from '../config/paytm.js';
 
import PaytmChecksum from 'paytmchecksum';
 
export const createPaytmPayment = async (id,amount) => {
  const orderId = `ORDER_${Date.now()}`;
  const customerId = `CUST_${id}_${Date.now()}`;

  const params = {
    requestType: "Payment",
    mid: paytmConfig.MID,
    websiteName: paytmConfig.WEBSITE,
    orderId,
    //callbackUrl: paytmConfig.CALLBACK_URL,
    callbackUrl:paytmConfig.API_CALLBACK,
    txnAmount: {
      value: amount,
      currency: "INR",
    },
    userInfo: {
      custId: customerId,
    },
  };

  const checksum = await PaytmChecksum.generateSignature(
    JSON.stringify(params),
    paytmConfig.MKEY
  );

  const response = await fetch(
    `${paytmConfig.HOST}/theia/api/v1/initiateTransaction?mid=${paytmConfig.MID}&orderId=${orderId}`,
    {
      method: 'POST',
      body: JSON.stringify({
        body: params,
        head: {
          signature: checksum,
        },
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );

  const data = await response.json();

  if (!data.body?.txnToken) {
    throw new Error('Failed to generate txnToken');
  }

  const paytmUrl = `${paytmConfig.HOST}/theia/api/v1/showPaymentPage?mid=${paytmConfig.MID}&orderId=${orderId}&txnToken=${data.body.txnToken}`;

  return {
    orderId,
    txnToken: data.body.txnToken,
    paytmUrl,
  };
};
