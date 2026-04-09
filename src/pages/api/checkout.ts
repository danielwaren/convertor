import type { APIRoute } from "astro";
import { supabase, getUserProfile } from "../../lib/supabase";
import { createProCheckout } from "../../lib/mercadopago";

export const POST: APIRoute = async ({ request }) => {
  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    }

    const token = authHeader.slice(7);
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    }

    const profile = await getUserProfile(data.user.id);
    if (profile?.plan === "pro") {
      return new Response(JSON.stringify({ error: "already_pro" }), { status: 400 });
    }

    const preference = await createProCheckout(data.user.id, data.user.email ?? "");

    return new Response(
      JSON.stringify({ checkout_url: preference.sandbox_init_point }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[checkout API]", err);
    return new Response(JSON.stringify({ error: "server_error" }), { status: 500 });
  }
};
