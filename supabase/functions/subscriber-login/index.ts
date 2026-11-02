import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'; import { corsHeaders } from '../_shared/cors.ts';
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json'}});
Deno.serve(async(req)=>{if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});if(req.method!=='POST')return json({message:'Método não permitido'},405);
try{const {email,secret,device='desconhecido'}=await req.json();if(typeof email!=='string'||typeof secret!=='string'||secret.length<8)return json({message:'E-mail ou chave inválidos.'},401);
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);const normalized=email.trim().toLowerCase();
const {data:sub}=await db.from('subscribers').select('*').eq('email',normalized).maybeSingle();if(!sub||sub.status!=='active'||new Date(sub.expires_at)<=new Date())return json({message:'Seu acesso não está ativo. Fale com a equipe para renovar sua assinatura.'},403);
const {data:ok}=await db.rpc('verify_subscriber_secret',{candidate:secret,stored_hash:sub.secret_hash});if(!ok)return json({message:'E-mail ou chave inválidos.'},401);
let uid=sub.auth_user_id;if(!uid){const {data:u,error}=await db.auth.admin.createUser({email:normalized,email_confirm:true,user_metadata:{role:'subscriber'}});if(error)throw error;uid=u.user.id;await db.from('subscribers').update({auth_user_id:uid}).eq('id',sub.id);await db.from('user_roles').upsert({user_id:uid,role:'subscriber'});}
const {data:link,error:linkError}=await db.auth.admin.generateLink({type:'magiclink',email:normalized});if(linkError)throw linkError;const otp=link.properties?.email_otp;if(!otp)throw new Error('Não foi possível emitir o código de sessão.');
const sessionToken=crypto.randomUUID();const {error:sessionError}=await db.rpc('replace_subscriber_session',{uid,raw_token:sessionToken,device_label:device});if(sessionError)throw sessionError;
return json({email_otp:otp,session_token:sessionToken});
}catch(e){console.error(e);return json({message:'Não foi possível validar o acesso.'},500);}});
