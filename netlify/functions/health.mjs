// ============================================================
//  NEXO - health check do backend  (GET /api/health)
//  Roda so no servidor: le as variaveis de ambiente do Netlify,
//  testa o Supabase com a ANON key e devolve apenas status.
//  NUNCA retorna valores de chaves; a SERVICE_ROLE_KEY so e
//  verificada quanto a existir, jamais enviada ao navegador.
// ============================================================

export default async () => {
  const url = Netlify.env.get("SUPABASE_URL");
  const anon = Netlify.env.get("SUPABASE_ANON_KEY");
  const out = {
    ok: false,
    db: Netlify.env.get("NEXO_DB") || null,
    supabase: {
      urlConfigured: Boolean(url),
      anonKeyConfigured: Boolean(anon),
      serviceRoleConfigured: Boolean(Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY")),
      reachable: false,
      status: null,
    },
  };

  if (url && anon) {
    try {
      const res = await fetch(url.replace(/\/+$/, "") + "/auth/v1/health", {
        headers: { apikey: anon },
        signal: AbortSignal.timeout(5000),
      });
      out.supabase.status = res.status;
      out.supabase.reachable = res.ok;
    } catch {
      out.supabase.status = "unreachable";
    }
  }

  out.ok = out.supabase.reachable;
  return Response.json(out, {
    status: out.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
};

export const config = { path: "/api/health" };
