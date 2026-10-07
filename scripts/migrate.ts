import { config } from '../src/lib/config';
import { db } from '../src/lib/store';
if (!config.database) throw new Error('Set DATABASE_URL before migrating');
await db().query(`CREATE TABLE IF NOT EXISTS video_jobs (
  id UUID PRIMARY KEY,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS video_jobs_status_idx ON video_jobs ((payload->>'status'));
CREATE INDEX IF NOT EXISTS video_jobs_updated_idx ON video_jobs (updated_at DESC);`);
await db().end(); console.log('Video job schema ready');
