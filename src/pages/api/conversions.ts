import type { APIRoute } from "astro";
import { checkLimit, incrementConversions } from "../../lib/ratelimit";
import { supabase, getUserProfile } from "../../lib/supabase";

export const POST: APIRoute = async ({ request, clientAddress }) => {
  console.log("UPSTASH URL:", import.meta.env.UPSTASH_REDIS_REST_URL);
  console.log("UPSTASH TOKEN:", import.meta.env.UPSTASH_REDIS_REST_TOKEN ? "existe" : "undefined")
  try {
    const body = await request.json().catch(() => ({}));
    const { action } = body as { action?: "check" | "increment" };

    // Intentar obtener sesión del header Authorization
    let userId: string | null = null;
    let plan: "anonymous" | "free" | "pro" = "anonymous";
    let identifier = clientAddress ?? "unknown";

    const authHeader = request.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const { data } = await supabase.auth.getUser(token);
      if (data?.user) {
        userId = data.user.id;
        identifier = `user:${userId}`;
        const profile = await getUserProfile(userId);
        plan = (profile?.plan as "free" | "pro") ?? "free";
      }
    }

    if (action === "check") {
      const { allowed, used, limit } = await checkLimit(identifier, plan);
      return new Response(
        JSON.stringify({ allowed, used, limit, plan }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    if (action === "increment") {
      const { allowed, used, limit } = await checkLimit(identifier, plan);
      if (!allowed) {
        return new Response(
          JSON.stringify({ error: "limit_reached", used, limit, plan }),
          { status: 429, headers: { "Content-Type": "application/json" } }
        );
      }
      const newCount = await incrementConversions(identifier);
      return new Response(
        JSON.stringify({ ok: true, used: newCount, limit, plan }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ error: "invalid_action" }), { status: 400 });
  } catch (err) {
    console.error("[conversions API]", err);
    return new Response(JSON.stringify({ error: "server_error" }), { status: 500 });
  }
};
