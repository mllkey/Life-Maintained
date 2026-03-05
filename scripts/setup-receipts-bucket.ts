import "dotenv/config";

const PROJECT_REF = "fqblqrrgjpwysrsiolcn";
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!ACCESS_TOKEN) {
  console.error("SUPABASE_ACCESS_TOKEN is not set");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${ACCESS_TOKEN}`,
  "Content-Type": "application/json",
};

async function runSql(query: string, label: string) {
  console.log(`Running: ${label}...`);
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ query }),
    }
  );
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = text; }

  if (!res.ok) {
    console.error(`${label} failed (${res.status}):`, json);
    throw new Error(`SQL failed for: ${label}`);
  }
  console.log(`${label} done.`);
  return json;
}

async function main() {
  try {
    await runSql(`
      INSERT INTO storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
      VALUES (
        'receipts',
        'receipts',
        false,
        ARRAY['image/jpeg', 'image/png', 'image/webp']::text[],
        10485760
      )
      ON CONFLICT (id) DO NOTHING;
    `, "Create receipts bucket");

    await runSql(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies
          WHERE schemaname = 'storage' AND tablename = 'objects'
          AND policyname = 'receipts_insert_own'
        ) THEN
          CREATE POLICY "receipts_insert_own"
          ON storage.objects FOR INSERT TO authenticated
          WITH CHECK (
            bucket_id = 'receipts'
            AND (storage.foldername(name))[1] = auth.uid()::text
          );
        END IF;
      END $$;
    `, "Insert RLS policy");

    await runSql(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies
          WHERE schemaname = 'storage' AND tablename = 'objects'
          AND policyname = 'receipts_select_own'
        ) THEN
          CREATE POLICY "receipts_select_own"
          ON storage.objects FOR SELECT TO authenticated
          USING (
            bucket_id = 'receipts'
            AND (storage.foldername(name))[1] = auth.uid()::text
          );
        END IF;
      END $$;
    `, "Select RLS policy");

    await runSql(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies
          WHERE schemaname = 'storage' AND tablename = 'objects'
          AND policyname = 'receipts_delete_own'
        ) THEN
          CREATE POLICY "receipts_delete_own"
          ON storage.objects FOR DELETE TO authenticated
          USING (
            bucket_id = 'receipts'
            AND (storage.foldername(name))[1] = auth.uid()::text
          );
        END IF;
      END $$;
    `, "Delete RLS policy");

    console.log("\nStorage setup complete!");
  } catch (err) {
    console.error("Setup failed:", err);
    process.exit(1);
  }
}

main();
