#!/usr/bin/env bash
# Start a throwaway local Supabase (Postgres, Auth and the REST API) for integration and
# E2E tests. `supabase start` applies supabase/migrations, so the menu table and seed rows
# exist. Then create a confirmed test user and export the settings to later steps.
# Nothing here touches the team's hosted Supabase project.
set -euo pipefail

supabase start -x realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor

status="$(supabase status -o json)"
read_status() {
  python3 -c 'import json, sys
d = json.loads(sys.argv[1])
print(next((d[k] for k in sys.argv[2:] if d.get(k)), ""))' "$status" "$@"
}

api_url="$(read_status API_URL)"
anon_key="$(read_status ANON_KEY PUBLISHABLE_KEY)"
service_key="$(read_status SERVICE_ROLE_KEY SECRET_KEY)"
db_url="$(read_status DB_URL)"
if [ -z "$api_url" ] || [ -z "$anon_key" ] || [ -z "$service_key" ] || [ -z "$db_url" ]; then
  echo "Could not read the local Supabase settings from 'supabase status'." >&2
  exit 1
fi

email="ci-student@vanderbilt.edu"
password="ci-$(openssl rand -hex 12)"
echo "::add-mask::$password"
curl --fail-with-body -sS -o /dev/null -X POST "$api_url/auth/v1/admin/users" \
  -H "apikey: $service_key" -H "Authorization: Bearer $service_key" -H "Content-Type: application/json" \
  -d "{\"email\": \"$email\", \"password\": \"$password\", \"email_confirm\": true}"

# The service key is only for test setup and cleanup. It must not start with SUPABASE_,
# because Vite sends every SUPABASE_* variable to the browser.
{
  echo "SUPABASE_URL=$api_url"
  echo "SUPABASE_KEY=$anon_key"
  echo "PUB_ORDER_TEST_SERVICE_KEY=$service_key"
  echo "PUB_ORDER_TEST_DB_URL=$db_url"
  echo "PUB_ORDER_TEST_EMAIL=$email"
  echo "PUB_ORDER_TEST_PASSWORD=$password"
} >> "$GITHUB_ENV"
echo "Local Supabase is ready at $api_url"
