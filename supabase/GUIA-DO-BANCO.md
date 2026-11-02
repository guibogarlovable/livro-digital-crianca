# Banco de dados — Pequenos Contos

Este guia descreve como criar o banco Supabase do zero para o projeto **Leitura-Infantil-Digital**.

## 1. Criar o projeto Supabase

1. Acesse https://supabase.com/dashboard e crie um projeto.
2. Escolha uma região próxima do público (por exemplo, São Paulo, se disponível).
3. Guarde a senha do banco em um gerenciador de senhas.
4. Em **Project Settings → API**, copie o Project URL e a chave **publishable** (ou anon legacy, se a interface ainda exibir essa opção).
5. No aplicativo, use o Project URL raiz: `https://SEU_PROJECT_ID.supabase.co` — não acrescente `/rest/v1/`.

Não publique a senha do banco nem a chave `service_role/secret`. A chave publishable/anon é própria para o cliente, desde que as políticas RLS estejam corretas.

## 2. Executar as migrações na ordem

No painel, abra **SQL Editor → New query**. Abra cada arquivo abaixo no GitHub, copie o conteúdo inteiro, cole no SQL Editor e clique em **Run**. Execute um por vez e nesta ordem:

1. [0001_initial_schema.sql](./migrations/0001_initial_schema.sql)
2. [0002_session_functions.sql](./migrations/0002_session_functions.sql)
3. [0003_subscription_and_security.sql](./migrations/0003_subscription_and_security.sql)

A primeira migração cria as tabelas principais, relacionamentos, enumerações, políticas RLS e bucket privado. A segunda cria as funções usadas pelo fluxo de autenticação/sessão. A terceira acrescenta período de teste, status de assinatura, histórico, auditoria, índices e regras de acesso consistentes.

## 3. Estrutura de tabelas e relacionamentos

- `auth.users` (gerenciada pelo Supabase Auth): identidade de cada responsável.
- `user_roles`: relação 1:1 com `auth.users`; define `admin` ou `subscriber`.
- `subscribers`: dados de assinatura e hash da chave de acesso; `auth_user_id` liga a conta Auth. Um responsável tem no máximo um registro de assinatura.
- `sessions`: sessões de dispositivo; cada sessão pertence a `auth.users`. Um índice parcial impede mais de uma sessão não revogada por usuário.
- `child_profiles`: vários perfis infantis por responsável (1:N).
- `categories`: categorias da biblioteca.
- `stories`: história, faixa etária, categoria, capa e estado de publicação.
- `story_pages`: páginas ordenadas de cada história (1:N).
- `story_questions`: perguntas opcionais de compreensão por história (1:N).
- `reads`: progresso por perfil e história; chave única impede duplicidade do mesmo par.
- `favorites`: favoritos por perfil e história; chave composta impede duplicidade.
- `reading_streaks`: resumo da sequência de leitura por perfil (1:1).
- `payment_customers`: referência ao cliente no provedor de pagamento (preparação para integração futura).
- `payment_events`: eventos recebidos do provedor, com identificador externo único para idempotência.
- `subscription_events`: histórico de criação, renovação, cancelamento, expiração e mudança de plano.
- `admin_audit_logs`: trilha de ações administrativas.

### Relacionamentos principais

```
auth.users 1──1 user_roles
auth.users 1──1 subscribers
auth.users 1──N sessions
auth.users 1──N child_profiles
child_profiles 1──N reads N──1 stories
child_profiles N──N stories (favorites)
child_profiles 1──1 reading_streaks
categories 1──N stories
stories 1──N story_pages
stories 1──N story_questions
subscribers 1──N subscription_events
subscribers 1──N payment_customers
subscribers 1──N payment_events (opcional)
```

## 4. Criar o primeiro administrador

1. No Supabase, abra **Authentication → Users → Add user**.
2. Crie a conta do administrador com um e-mail seu e uma senha forte.
3. Copie o UUID desse usuário.
4. No SQL Editor, execute substituindo o UUID:

```sql
insert into public.user_roles (user_id, role)
values ('UUID_DO_USUARIO_AUTH', 'admin')
on conflict (user_id)
do update set role = excluded.role;
```

Não crie o administrador inserindo diretamente em `subscribers`. A função administrativa é controlada por `user_roles`.

## 5. Configurar Storage

A migração cria o bucket privado `story-art`, destinado às capas e imagens das páginas. Mantenha-o privado. O aplicativo deverá solicitar URLs assinadas de curta duração após validar a autorização do usuário. Não torne esse bucket público para contornar erros de permissão.

## 6. Configuração do aplicativo

No arquivo `.env` local (não envie para o GitHub), configure:

```env
VITE_SUPABASE_URL=https://SEU_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON_KEY=SUA_CHAVE_PUBLISHABLE_OU_ANON
```

A chave publishable/anon pode estar no frontend; a chave service_role nunca pode. Segredos administrativos e geração/verificação de chaves de assinantes devem ficar em Edge Functions.

## 7. Regras importantes

- O cadastro público deve permanecer desativado no produto. O administrador provisiona assinantes.
- Guarde apenas hash forte da chave secreta do assinante; nunca armazene a chave em texto puro.
- O teste gratuito de 7 dias deve ser representado por `status='trial'`, `trial_started_at`, `trial_ends_at` e `expires_at`.
- Ao cancelar, suspender ou expirar, atualize `subscribers.status` e registre um `subscription_events`.
- RLS deve permanecer habilitado. Não crie políticas permissivas como `using (true)` para tabelas privadas.
- O índice parcial em `sessions` permite apenas uma sessão ativa por usuário. A Edge Function deve revogar a anterior ao autenticar um novo dispositivo.
- O banco está preparado para registrar pagamentos, mas não há gateway configurado nesta etapa.

## 8. Limites desta entrega

As migrações definem a estrutura inicial e controles no banco; não significam que o aplicativo já esteja integrado, publicado ou testado. Antes de produção, ainda será necessário validar o fluxo completo de login e sessão, provisionamento administrativo, upload/URLs assinadas, persistência do progresso e testes das políticas RLS com contas de admin e assinante.
