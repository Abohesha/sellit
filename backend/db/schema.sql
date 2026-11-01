-- Plain PostgreSQL (no Supabase-specific features) so we can move off Supabase later.
-- Run against the EU-region Supabase project. The backend connects with DATABASE_URL;
-- RLS is enabled with no policies so the public API keys cannot read these tables.

create extension if not exists pgcrypto;

create table if not exists app_users (
  id uuid primary key,                       -- = Supabase auth user id
  created_at timestamptz not null default now(),
  privacy_policy_version text,
  privacy_consent_at timestamptz,
  ai_processing_consent_at timestamptz
);

create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'ready', 'published', 'sold')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists items_user_idx on items(user_id, created_at desc);

create table if not exists photos (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id) on delete cascade,
  kind text not null check (kind in ('front', 'back', 'label', 'flaw', 'extra')),
  storage_path text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists photos_item_idx on photos(item_id);

create table if not exists listing_drafts (
  item_id uuid primary key references items(id) on delete cascade,
  marketplace_id text not null,
  raw_ai_output text not null,               -- exactly what the model returned
  ai_listing jsonb not null,                 -- validated output
  mapping jsonb,                             -- eBay category candidates + required aspects
  edits jsonb,                               -- the user's reviewed version
  reviewed_at timestamptz,
  ai_model text not null,
  ai_attempts int not null,
  ai_input_tokens int not null,
  ai_output_tokens int not null,
  ai_cost_usd numeric(12, 6) not null,
  created_at timestamptz not null default now()
);

create table if not exists ebay_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  marketplace_id text not null,
  refresh_token_enc text not null,           -- AES-256-GCM, key in env/secrets manager
  refresh_token_expires_at timestamptz,
  fulfillment_policy_id text,
  payment_policy_id text,
  return_policy_id text,
  merchant_location_key text,
  created_at timestamptz not null default now(),
  unique (user_id, marketplace_id)
);

create table if not exists published_listings (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id) on delete cascade,
  marketplace_id text not null,
  sku text not null,
  offer_id text not null,
  ebay_listing_id text not null,
  url text not null,
  status text not null default 'active' check (status in ('active', 'sold', 'ended')),
  created_at timestamptz not null default now(),
  unique (item_id, marketplace_id)
);

create table if not exists jobs (
  id text primary key,                       -- BullMQ job id
  user_id uuid not null references app_users(id) on delete cascade,
  item_id uuid references items(id) on delete cascade,
  type text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists jobs_item_idx on jobs(item_id, created_at desc);

alter table app_users enable row level security;
alter table items enable row level security;
alter table photos enable row level security;
alter table listing_drafts enable row level security;
alter table ebay_connections enable row level security;
alter table published_listings enable row level security;
alter table jobs enable row level security;
