import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

async function hash(value: string) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ message: 'Método não permitido.' }, 405);
  }

  try {
    const { email, email_otp, device = 'desconhecido' } = await req.json();

    if (
      typeof email !== 'string' ||
      typeof email_otp !== 'string' ||
      !email.trim() ||
      !email_otp.trim()
    ) {
      return json({ message: 'E-mail e código OTP são obrigatórios.' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !anonKey || !serviceKey) {
      throw new Error('Configuração do Supabase ausente.');
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: authData, error: otpError } =
      await authClient.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: email_otp.trim(),
        type: 'magiclink',
      });

    if (otpError || !authData.user) {
      return json({ message: 'Código inválido ou expirado.' }, 401);
    }

    const db = createClient(supabaseUrl, serviceKey);
    const { data: sub, error: subError } = await db
      .from('subscribers')
      .select('id, status, expires_at, auth_user_id')
      .eq('auth_user_id', authData.user.id)
      .maybeSingle();

    if (subError) throw subError;

    if (
      !sub ||
      sub.status !== 'active' ||
      new Date(sub.expires_at) <= new Date()
    ) {
      return json({ message: 'Assinatura inativa ou expirada.' }, 403);
    }

    const sessionToken = crypto.randomUUID();
    const { error: sessionError } = await db.rpc(
      'replace_subscriber_session',
      {
        uid: authData.user.id,
        raw_token: sessionToken,
        device_label: typeof device === 'string' ? device.slice(0, 120) : 'desconhecido',
      },
    );

    if (sessionError) throw sessionError;

    return json({
      session_token: sessionToken,
      access_token: authData.session?.access_token,
      token_type: authData.session?.token_type,
      expires_in: authData.session?.expires_in,
    });
  } catch (error) {
    console.error('Falha ao confirmar OTP:', error);
    return json({ message: 'Não foi possível confirmar o código.' }, 500);
  }
});
