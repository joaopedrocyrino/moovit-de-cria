// Private PostgreSQL aggregate export in a consistent, read-only transaction.
import pg from "pg";
import { openDatabase } from "./lib/postgres.mjs";
import { writeFile } from "node:fs/promises";
const args = process.argv.slice(2);
function option(name, fallback) {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
}
const schema = option("--schema", "app");
const days = Number(option("--days", "30"));
if (!Number.isInteger(days) || days < 1 || days > 90)
  throw new Error(
    "Usage: node scripts/analytics-report.mjs [--schema app] [--days 30] [--output report.json]",
  );
pg.types.setTypeParser(20, Number);
pg.types.setTypeParser(1700, Number);
const db = await openDatabase(undefined, schema);
await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
try {
  const cutoff = Date.now() - days * 86400000;
  const query = async (sql) => (await db.query(sql, [cutoff])).rows;
  const report = {
    generatedAt: new Date().toISOString(),
    days,
    schemaVersion: 1,
    overview: await query(
      "SELECT count(*) AS events, count(DISTINCT visitor) AS browsers, count(DISTINCT session) AS sessions FROM usage_events WHERE received_at>=$1",
    ),
    daily: await query(
      "SELECT to_char(to_timestamp(occurred_at/1000.0) AT TIME ZONE 'UTC','YYYY-MM-DD') AS day, count(*) AS events, count(DISTINCT visitor) AS browsers FROM usage_events WHERE received_at>=$1 GROUP BY day ORDER BY day",
    ),
    events: await query(
      "SELECT name, count(*) AS events, count(DISTINCT visitor) AS browsers FROM usage_events WHERE received_at>=$1 GROUP BY name ORDER BY events DESC",
    ),
    funnel: await query(`WITH stages AS (
      SELECT session,
        min(CASE WHEN name='app_open' THEN occurred_at END) AS opened,
        min(CASE WHEN name='route_search' THEN occurred_at END) AS searched,
        min(CASE WHEN name='route_result' AND (properties->>'count')::numeric>0 THEN occurred_at END) AS found,
        min(CASE WHEN name='route_selected' THEN occurred_at END) AS selected,
        min(CASE WHEN name='journey_step' AND (properties->>'step')='board' THEN occurred_at END) AS boarded
      FROM usage_events WHERE received_at>=$1 GROUP BY session)
      SELECT count(opened) AS opened,
        sum(CASE WHEN searched>=opened THEN 1 ELSE 0 END) AS searched,
        sum(CASE WHEN searched>=opened AND found>=searched THEN 1 ELSE 0 END) AS found,
        sum(CASE WHEN searched>=opened AND found>=searched AND selected>=found THEN 1 ELSE 0 END) AS selected,
        sum(CASE WHEN searched>=opened AND found>=searched AND selected>=found AND boarded>=selected THEN 1 ELSE 0 END) AS boarded FROM stages`),
    releases: await query(
      "SELECT (properties->>'release') AS release,count(*) AS opens FROM usage_events WHERE received_at>=$1 AND name='app_open' GROUP BY release",
    ),
    browsers: await query(
      "SELECT (properties->>'browser') AS browser, (properties->>'os') AS os, count(*) AS opens FROM usage_events WHERE received_at>=$1 AND name='app_open' GROUP BY browser,os",
    ),
    location: await query(
      "SELECT (properties->>'result') AS result,count(*) AS events FROM usage_events WHERE received_at>=$1 AND name='location_result' GROUP BY result",
    ),
    failures: await query(
      "SELECT (properties->>'endpoint') AS endpoint,(properties->>'status')::numeric AS status,count(*) AS events FROM usage_events WHERE received_at>=$1 AND name='api_result' AND ((properties->>'status')::numeric>=400 OR (properties->>'status')::numeric=0) GROUP BY endpoint,status",
    ),
    engagement: await query(
      "SELECT count(DISTINCT session) AS sessions, round(sum((properties->>'duration')::numeric)/1000.0) AS activeSeconds FROM usage_events WHERE received_at>=$1 AND name='engagement'",
    ),
    performance: await query(
      "SELECT (properties->>'metric') AS metric,count(*) AS samples,round(avg((properties->>'value')::numeric),2) AS average,max((properties->>'value')::numeric) AS maximum FROM usage_events WHERE received_at>=$1 AND name='performance' GROUP BY metric",
    ),
    favorites: await query(
      "SELECT (properties->>'storage') AS storage,(properties->>'kind') AS kind,(properties->>'action') AS action,count(*) AS events FROM usage_events WHERE received_at>=$1 AND name='saved_change' GROUP BY storage,kind,action",
    ),
  };
  const json = JSON.stringify(report, null, 2) + "\n";
  const output = option("--output");
  if (output) await writeFile(output, json);
  else process.stdout.write(json);
} finally {
  await db.query("ROLLBACK");
  await db.end();
}
