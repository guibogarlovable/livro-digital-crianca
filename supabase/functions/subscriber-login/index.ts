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
    const resendApiKey = Deno.env.get('RESEND_API_KEY');

    if (!serviceKey || !supabaseUrl || !resendApiKey) {
      throw new Error('Configuração do Supabase ou Resend ausente.');
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

    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Pequenos Contos <onboarding@resend.dev>',
        to: [normalized],
        subject: 'Seu código de acesso — Pequenos Contos',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:28px;color:#342f2b">
            <h1 style="color:#765b48">Pequenos Contos</h1>
            <p>Use o código abaixo para confirmar seu acesso à biblioteca:</p>
            <p style="font-size:32px;font-weight:bold;letter-spacing:8px;padding:16px;background:#f7f1e9;text-align:center;border-radius:12px">${otp}</p>
            <p>Esse código é de uso único e pode expirar. Se você não solicitou este acesso, ignore esta mensagem.</p>
          </div>
        `,
      }),
    });

    if (!emailResponse.ok) {
      const detail = await emailResponse.text();
      console.error('Resend rejeitou o envio:', detail);
      throw new Error('Não foi possível enviar o e-mail de confirmação.');
    }

    // O OTP nunca é devolvido ao navegador. A sessão só nasce após a confirmação.
    return json({ success: true, message: 'Código enviado para seu e-mail.' });
  } catch (error) {
    console.error('Falha no login do assinante:', error);
    return json({ message: 'Não foi possível enviar o código de acesso.' }, 500);
  }
});
