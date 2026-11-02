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
    const { email, secret } = await req.json();

    if (
      typeof email !== 'string' ||
      typeof secret !== 'string' ||
      secret.length < 8
    ) {
      return json({ message: 'E-mail ou chave inválidos.' }, 401);
    }

    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');

    if (!serviceKey || !supabaseUrl) {
      throw new Error('Configuração do Supabase ausente.');
    }

    const db = createClient(supabaseUrl, serviceKey);
    const normalized = email.trim().toLowerCase();

    const { data: sub, error: subError } = await db
      .from('subscribers')
      .select('id, email, secret_hash, plan, expires_at, status, auth_user_id')
      .eq('email', normalized)
      .maybeSingle();

    if (subError) throw subError;

    if (
      !sub ||
      sub.status !== 'active' ||
      new Date(sub.expires_at) <= new Date()
    ) {
      return json({
        message: 'Seu acesso não está ativo. Fale com a equipe para renovar sua assinatura.',
      }, 403);
    }

    const { data: validSecret, error: verifyError } = await db.rpc(
      'verify_subscriber_secret',
      { candidate: secret, stored_hash: sub.secret_hash },
    );

    if (verifyError) throw verifyError;
    if (!validSecret) {
      return json({ message: 'E-mail ou chave inválidos.' }, 401);
    }

    let uid = sub.auth_user_id;

    if (!uid) {
      const { data: created, error: createError } =
        await db.auth.admin.createUser({
          email: normalized,
          email_confirm: true,
          user_metadata: { role: 'subscriber' },
        });

      if (createError) throw createError;
      uid = created.user.id;

      const { error: subscriberUpdateError } = await db
        .from('subscribers')
        .update({ auth_user_id: uid })
        .eq('id', sub.id);

      if (subscriberUpdateError) throw subscriberUpdateError;

      const { error: roleError } = await db
        .from('user_roles')
        .upsert({ user_id: uid, role: 'subscriber' });

      if (roleError) throw roleError;
    }

    const { data: link, error: linkError } =
      await db.auth.admin.generateLink({
        type: 'magiclink',
        email: normalized,
      });

    if (linkError) throw linkError;

    const otp = link.properties?.email_otp;
    if (!otp) throw new Error('Não foi possível emitir o código OTP.');

    // A sessão personalizada só será criada após a confirmação do OTP.
    return json({ email_otp: otp });
  } catch (error) {
    console.error('Falha no login do assinante:', error);
    return json({ message: 'Não foi possível validar o acesso.' }, 500);
  }
});
