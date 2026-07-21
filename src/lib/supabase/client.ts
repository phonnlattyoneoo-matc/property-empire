"use client";

import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

export function hasSupabaseConfig() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

export function getSupabaseBrowserClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabasePublishableKey) {
    return null;
  }

  browserClient ??= createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
    },
  });

  return browserClient;
}

export async function ensureAnonymousUser(
  supabase: SupabaseClient,
): Promise<User> {
  const {
    data: { user: existingUser },
    error: existingUserError,
  } = await supabase.auth.getUser();

  if (existingUser) {
    return existingUser;
  }

  if (existingUserError && existingUserError.name !== "AuthSessionMissingError") {
    throw existingUserError;
  }

  const {
    data: { user },
    error,
  } = await supabase.auth.signInAnonymously();

  if (error) {
    throw error;
  }

  if (!user) {
    throw new Error("Could not start an anonymous online session.");
  }

  return user;
}
