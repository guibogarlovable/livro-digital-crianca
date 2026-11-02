create or replace function public.verify_subscriber_secret(candidate text,stored_hash text) returns boolean language sql security definer set search_path=public as $$ select crypt(candidate,stored_hash)=stored_hash; $$;
revoke all on function public.verify_subscriber_secret(text,text) from public,anon,authenticated;
grant execute on function public.verify_subscriber_secret(text,text) to service_role;
create or replace function public.replace_subscriber_session(uid uuid,raw_token text,device_label text) returns void language plpgsql security definer set search_path=public as $$ begin update public.sessions set revoked_at=now() where user_id=uid and revoked_at is null; insert into public.sessions(user_id,token_hash,device) values(uid,encode(digest(raw_token,'sha256'),'hex'),device_label); end; $$;
revoke all on function public.replace_subscriber_session(uuid,text,text) from public,anon,authenticated;
grant execute on function public.replace_subscriber_session(uuid,text,text) to service_role;
