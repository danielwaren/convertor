import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type UserPlan = "free" | "pro";

export interface UserProfile {
  id: string;
  email: string;
  plan: UserPlan;
  plan_expires_at: string | null;
}

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from("users")
    .select("id, email, plan, plan_expires_at")
    .eq("id", userId)
    .single();

  if (error || !data) return null;

  // Si el plan pro venció, lo revierte a free
  if (data.plan === "pro" && data.plan_expires_at) {
    const expired = new Date(data.plan_expires_at) < new Date();
    if (expired) {
      await supabase.from("users").update({ plan: "free", plan_expires_at: null }).eq("id", userId);
      data.plan = "free";
    }
  }

  return data as UserProfile;
}
