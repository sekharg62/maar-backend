export const paytmConfig = {
  MID: "BKtOxV80500970194655",
  MKEY: "OsO7ukP0tuMrTjsN",
  WEBSITE: "DEFAULT",
  CHANNEL_ID: "WEB",
  INDUSTRY_TYPE_ID: "Retail",
  //CALLBACK_URL: "http://localhost:3000/psychometric?success=1", // frontent call back url
  API_CALLBACK: "http://localhost:3001/api/student/paymentCallback", //For update payment field set true ,identify students payment is done
  ENV: "production",
  HOST: "https://securegw.paytm.in", // Use securegw-stage.paytm.in for testing
};
