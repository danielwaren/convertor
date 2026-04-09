import MercadoPago, { Preference } from "mercadopago";

const isTest = import.meta.env.MODE !== "production";

const mp = new MercadoPago({
  accessToken: isTest
    ? import.meta.env.MP_ACCESS_TOKEN_TEST
    : import.meta.env.MP_ACCESS_TOKEN,
});

const SITE_URL = import.meta.env.PUBLIC_SITE_URL;

export async function createProCheckout(userId: string, userEmail: string) {
  const preference = new Preference(mp);

  const response = await preference.create({
    body: {
      items: [
        {
          id: "pro-monthly",
          title: "WebP Convert Pro — 1 mes",
          description: "Conversiones ilimitadas por 30 días",
          quantity: 1,
          unit_price: 5,
          currency_id: "USD",
        },
      ],
      payer: {
        email: userEmail,
      },
      external_reference: userId,
      back_urls: {
        success: `${SITE_URL}/pago/gracias`,
        failure: `${SITE_URL}/pago/error`,
        pending: `${SITE_URL}/pago/pendiente`,
      },
      auto_return: "approved",
      notification_url: `${SITE_URL}/api/mp-webhook`,
      expires: false,
    },
  });

  return response;
}
