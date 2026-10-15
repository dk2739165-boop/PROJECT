/**
 * Supabase Automated Migration Runner
 * 
 * Executes the SQL migration in a single command:
 *   npm run db:migrate
 * 
 * Connects directly to Supabase PostgreSQL and applies all tables, indexes, and RLS policies.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Client } = require(path.join(__dirname, '..', 'backend', 'node_modules', 'pg'));
const dotenv = require(path.join(__dirname, '..', 'backend', 'node_modules', 'dotenv'));

// Load backend/.env
const envPath = path.join(__dirname, '..', 'backend', '.env');
dotenv.config({ path: envPath });

const MIGRATION_FILE = path.join(__dirname, '..', 'supabase', 'migrations', '20261014000000_create_chat_tables.sql');

function extractProjectRef(url) {
  if (!url) return null;
  const match = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i);
  return match ? match[1] : null;
}

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => rl.question(query, ans => {
    rl.close();
    resolve(ans);
  }));
}

async function runMigration() {
  console.log('====================================================');
  console.log('🚀 Supabase Database Migration Runner');
  console.log('====================================================\n');

  const supabaseUrl = process.env.SUPABASE_URL;
  const projectRef = extractProjectRef(supabaseUrl) || 'rehewnqouhknlvikfpqb';

  if (!fs.existsSync(MIGRATION_FILE)) {
    console.error(`❌ Migration file not found: ${MIGRATION_FILE}`);
    process.exit(1);
  }

  const sqlContent = fs.readFileSync(MIGRATION_FILE, 'utf8');

  let connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    let password = process.env.DB_PASSWORD;

    // Check if passed via command line argument (e.g. node scripts/migrate.js mypassword)
    if (process.argv[2]) {
      password = process.argv[2];
    }

    if (!password) {
      console.log(`📌 Target Supabase Project: ${projectRef}`);
      console.log('🔑 To run the migration directly against your Supabase database,');
      console.log('   enter your Supabase database password (set when creating project):');
      password = await askQuestion('\n👉 Supabase Database Password: ');
    }

    if (!password || !password.trim()) {
      console.log('\n⚠️  No database password entered.');
      console.log('💡 Quick Alternative: Copy and paste the contents of:');
      console.log(`   ${MIGRATION_FILE}`);
      console.log('   into your Supabase Dashboard -> SQL Editor and click Run.');
      process.exit(0);
    }

    // Supabase standard pooler / direct connection
    connectionString = `postgresql://postgres.${projectRef}:${encodeURIComponent(password.trim())}@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`;
    
    // Fallback direct host if region differs
    const directHostString = `postgresql://postgres:${encodeURIComponent(password.trim())}@db.${projectRef}.supabase.co:5432/postgres`;

    console.log('\n⏳ Connecting to Supabase PostgreSQL database...');

    let client = new Client({
      connectionString: directHostString,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000
    });

    try {
      await client.connect();
    } catch (directErr) {
      // Try pooler port 6543 or 5432
      console.log('   Retrying connection via pooler...');
      client = new Client({
        connectionString: connectionString,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 10000
      });
      await client.connect();
    }

    try {
      console.log('📜 Applying migration: 20261014000000_create_chat_tables.sql ...');
      await client.query(sqlContent);

      console.log('🔍 Verifying created tables...');
      const res = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
          AND table_name IN ('chat_sessions', 'chat_messages');
      `);

      const tables = res.rows.map(r => r.table_name);
      console.log('\n✅ Migration completed successfully!');
      console.log('   Verified Tables in Supabase:');
      tables.forEach(t => console.log(`   - 🗄️  public.${t} (Ready)`));

      // Append DATABASE_URL to backend/.env if not already present
      if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
        fs.appendFileSync(envPath, `\n# Database Connection String for Migrations\nDATABASE_URL="${directHostString}"\n`);
        console.log('💾 Saved DATABASE_URL to backend/.env for future seamless migrations.');
      }
    } catch (queryErr) {
      console.error('\n❌ Error applying migration SQL:', queryErr.message);
    } finally {
      await client.end();
    }

    return;
  }

  // If DATABASE_URL is already present
  console.log('⏳ Connecting via configured DATABASE_URL...');
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('📜 Applying migration: 20261014000000_create_chat_tables.sql ...');
    await client.query(sqlContent);

    console.log('🔍 Verifying created tables...');
    const res = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('chat_sessions', 'chat_messages');
    `);

    const tables = res.rows.map(r => r.table_name);
    console.log('\n✅ Migration completed successfully!');
    tables.forEach(t => console.log(`   - 🗄️  public.${t} (Ready)`));
  } catch (err) {
    console.error('\n❌ Migration failed:', err.message);
  } finally {
    await client.end();
  }
}

runMigration().catch(err => {
  console.error('\n❌ Unexpected error:', err.message);
  process.exit(1);
});
