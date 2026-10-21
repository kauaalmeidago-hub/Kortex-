/**
 * Enables local interface checks without a Supabase session. This flag is only
 * honored by Vite's development server; production builds always keep auth.
 */
export const localAuthBypass =
  import.meta.env.MODE === "development" &&
  import.meta.env.VITE_LOCAL_AUTH_BYPASS === "true";
