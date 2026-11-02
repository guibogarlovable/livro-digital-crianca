// Deploy with: supabase functions deploy subscriber-login
// Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY as function secrets.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json'}});
Deno.serve(async(req)=>{if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});if(req.method!=='POST')return json({message:'Método não permitido'},405);
try{const {email,secret,device='desconhecido'}=await req.json();if(typeof email!=='string'||typeof secret!=='string'||secret.length<8)return json({message:'E-mail ou chave inválidos.'},401);
const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;const db=createClient(url,key);
const {data:sub}=await db.from('subscribers').select('*').eq('email',email.toLowerCase()).maybeSingle();if(!sub||sub.status!=='active'||new Date(sub.expires_at)<=new Date())return json({message:'Seu acesso não está ativo. Fale com a equipe para renovar sua assinatura.'},403);
const {data:match}=await db.rpc('verify_subscriber_secret',{candidate:secret,stored_hash:sub.secret_hash});if(!match)return json({message:'E-mail ou chave inválidos.'},401);
let authUser=sub.auth_user_id;if(!authUser){const {data:u,error}=await db.auth.admin.createUser({email:sub.email,email_confirm:true,user_metadata:{role:'subscriber'}});if(error)throw error;authUser=u.user.id;await db.from('subscribers').update({auth_user_id:authUser}).eq('id',sub.id);await db.from('user_roles').upsert({user_id:authUser,role:'subscriber'});}
const {data:session,error}=await db.auth.admin.generateLink({type:'magiclink',email:sub.email});if(error)throw error;
// Session creation/revocation is atomic in SQL RPC; magic link is exchanged by the client in the next step.
const token=crypto.randomUUID();const {error:sessionError}=await db.rpc('replace_subscriber_session',{uid:authUser,raw_token:token,device_label:device});if(sessionError)throw sessionError;
return json({message:'Credenciais válidas. Configure o fluxo de emissão da sessão no deploy.',session:null,session_token:token});
}catch(e){console.error(e);return json({message:'Não foi possível validar o acesso.'},500);}});
