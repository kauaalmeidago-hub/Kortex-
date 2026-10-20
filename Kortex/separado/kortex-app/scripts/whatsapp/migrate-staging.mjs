import { readFile } from 'node:fs/promises';
import { remoteQuery } from '../isolation/staging-remote.mjs';
const environment = (await remoteQuery('SELECT name FROM app_private.deployment_environment WHERE singleton'))[0]?.name;
if (environment !== 'staging') throw new Error('STAGING_REQUIRED');
for (const file of ['20261020210000_whatsapp_chat.sql','20261020211000_whatsapp_read.sql','20261020212000_whatsapp_onboarding.sql','20261020213000_whatsapp_signup_proof.sql','20261020214000_whatsapp_cleanup_guard.sql']) {
  const version = file.slice(0,14), name = file.slice(15,-4);
  const sql = await readFile(new URL('../../supabase/migrations/' + file, import.meta.url), 'utf8');
  const applied = await remoteQuery(`SELECT statements FROM supabase_migrations.schema_migrations WHERE version='${version}'`);
  if (applied.length) { if (applied[0].statements.join('\n') !== sql) throw new Error('MIGRATION_DRIFT'); console.log('ALREADY_APPLIED', file); continue; }
  await remoteQuery(`BEGIN;SET LOCAL lock_timeout='10s';SET LOCAL statement_timeout='90s';SELECT pg_advisory_xact_lock(1743120198);${sql}
    INSERT INTO supabase_migrations.schema_migrations(version,statements,name) VALUES('${version}',ARRAY[$wa_migration$${sql}$wa_migration$],'${name}');COMMIT;`);
  console.log('STAGING_APPLIED', file);
}
