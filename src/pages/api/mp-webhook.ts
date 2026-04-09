import type { APIRoute } from "astro";
import MercadoPago, { Payment } from "mercadopago";
import { createClient } from "@supabase/supabase-js";

// Cliente con service_role para escribir sin RLS
const supabaseAdmin = createClient(
  import.meta.env.PUBLIC_SUPABASE_URL,
  import.meta.env.SUPABASE_SERVICE_ROLE_KEY
);

const mp = new MercadoPago({
  accessToken: import.meta.env.MODE === "production"
    ? import.meta.env.MP_ACCESS_TOKEN
    : import.meta.env.MP_ACCESS_TOKEN_TEST,
});

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();

    // MercadoPago envía distintos tipos de notificación
    if (body.type !== "payment") {
      return new Response("ok", { status: 200 });
    }

    const paymentId = body.data?.id;
    if (!paymentId) return new Response("no payment id", { status: 400 });

    // Obtener detalles del pago
    const paymentClient = new Payment(mp);
    const payment = await paymentClient.get({ id: paymentId });

    if (payment.status !== "approved") {
      return new Response("payment not approved", { status: 200 });
    }

    const userId = payment.external_reference;
    if (!userId) return new Response("no user ref", { status: 400 });

    // Activar plan Pro por 30 días
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const { error } = await supabaseAdmin
      .from("users")
      .update({
        plan: "pro",
        plan_expires_at: expiresAt.toISOString(),
        mp_payment_id: String(paymentId),
      })
      .eq("id", userId);

    if (error) {
      console.error("[webhook] supabase error:", error);
      return new Response("db error", { status: 500 });
    }

    console.log(`[webhook] Pro activado para usuario ${userId} hasta ${expiresAt.toISOString()}`);
    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("[webhook] error:", err);
    return new Response("server error", { status: 500 });
  }
};
