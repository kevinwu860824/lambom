# lambom

A BOM (Bill of Materials) comparison tool. Reads BOM data for multiple machines from Supabase, and lets you pick two to compare their differences.

Next.js (App Router) + Tailwind v4 + shadcn/ui, UI style carried over from gallery205_admin_web.

## Development

```bash
npm install
cp .env.example .env.local  # fill in the Supabase URL / anon key
npm run dev
```

## Environment variables

See `.env.example`:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
