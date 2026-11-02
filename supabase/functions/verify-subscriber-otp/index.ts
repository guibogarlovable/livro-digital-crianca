import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ message: 'Método não permitido.' }, 405);
  }

  try {
    const { email, email_otp } = await req.json();

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

    if (!supabaseUrl || !anonKey) {
      throw new Error('Configuração do Supabase ausente.');
    }

    const supabase = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: email_otp.trim(),
      type: 'magiclink',
    });

    if (error || !data.session) {
      return json({ message: 'Código inválido ou expirado.' }, 401);
    }

    return json({
      access_token: data.session.access_token,
      token_type: data.session.token_type,
      expires_in: data.session.expires_in,
    });
  } catch (error) {
    console.error('Falha ao confirmar OTP:', error);
    return json({ message: 'Não foi possível confirmar o código.' }, 500);
  }
});
