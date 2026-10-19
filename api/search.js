import pg from 'pg';
const { Pool } = pg;
const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
let pool;
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const q = String(req.query.q || '').trim().slice(0, 150);
  if (!q) return res.status(400).json({ error: 'Enter a search term' });
  if (!connectionString) return res.status(503).json({ error: 'Search database not configured' });
  try {
    pool ||= new Pool({ connectionString, max: 3, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000, ssl: { rejectUnauthorized: true } });
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 10);
    const result = await pool.query(`
      SELECT url, title, description,
        (SELECT COALESCE(SUM(
          CASE WHEN lower(COALESCE(p.title,'')) LIKE '%' || term || '%' THEN 12 ELSE 0 END +
          CASE WHEN lower(COALESCE(p.description,'')) LIKE '%' || term || '%' THEN 5 ELSE 0 END +
          CASE WHEN lower(COALESCE(p.content,'')) LIKE '%' || term || '%' THEN 1 ELSE 0 END
        ),0) FROM unnest($1::text[]) AS term) AS score
      FROM bubbles_pages p
      ORDER BY score DESC, url ASC
      LIMIT 30
    `, [terms]);
    const hits = result.rows.filter(r => Number(r.score) > 0).map(({url,title,description})=>({url,title,description}));
    const count = await pool.query('SELECT COUNT(*)::integer AS total FROM bubbles_pages');
    return res.status(200).json({ pages: hits, total: count.rows[0].total });
  } catch (err) {
    console.error('Bubbles search failed:', err.message);
    return res.status(503).json({ error: 'Search temporarily unavailable' });
  }
}
