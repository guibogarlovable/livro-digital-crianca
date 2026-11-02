# Pequenos Contos

Aplicativo web mobile-first para famílias lerem histórias ilustradas com crianças de 0 a 5 anos. Interface em português brasileiro, leitor de livro, perfis infantis e base PWA.

## Stack
- React + TypeScript + Vite
- Supabase Auth, Postgres, Storage e Edge Functions
- PWA com manifest e service worker básico

## Rodar localmente
```bash
npm install
cp .env.example .env.local
npm run dev
```
Preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` com os dados do projeto Supabase.

## Configurar Supabase
1. Crie um projeto Supabase.
2. Aplique, em ordem, os arquivos de `supabase/migrations` no SQL Editor.
3. Configure os segredos das Edge Functions: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` e opcionalmente `APP_ORIGIN`.
4. Faça deploy de `subscriber-login` e `validate-session`.
5. Crie um usuário administrador no Supabase Auth e associe-o em `user_roles` com papel `admin`. Para exibir os controles de admin no protótipo, defina também `user_metadata.role = admin` para esse usuário.
6. Cadastre assinantes por processo administrativo seguro, gravando `secret_hash = crypt(chave, gen_salt('bf'))`. Nunca grave a chave em texto puro.
7. O bucket privado `story-art` é criado pela migração. Use URLs assinadas para servir imagens privadas; não torne o bucket público.

Exemplo de criação do hash de uma chave:
```sql
select crypt('CHAVE_GERADA_FORA_DO_BANCO', gen_salt('bf'));
```
Não use a chave de exemplo acima em produção. Gere chaves aleatórias e entregue cada chave ao assinante por canal privado.

## Segurança
- As tabelas têm RLS habilitado.
- A chave do assinante é verificada no servidor com bcrypt/pgcrypto.
- A sessão anterior é revogada ao autenticar um novo dispositivo; a função `validate-session` valida o token armazenado no cliente e atualiza `last_seen_at`.
- A service role só deve existir como secret nas Edge Functions, nunca no frontend.
- A autorização real de administrador é aplicada por `user_roles` e `is_admin()`.

## Estado desta entrega
Esta é uma primeira base funcional de interface e backend, ainda não um produto pronto para produção. A biblioteca e o leitor usam histórias de demonstração; perfis, favoritos, progresso e filtros estão no estado local do navegador. O painel administrativo apresenta o início do fluxo, mas ainda não implementa CRUD completo de assinantes/histórias, editor com upload/ordenação em lote nem URLs assinadas de imagens. O fluxo de assinatura está preparado no esquema, sem cobrança integrada. Antes de abrir a usuários reais, conclua essas integrações, testes de segurança e revisão das Edge Functions.
