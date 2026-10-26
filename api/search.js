import pg from 'pg';
const { Pool } = pg;

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
let pool;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const raw = Array.isArray(req.query.q) ? req.query.q[0] : req.query.q;
  const q = String(raw || '').trim().slice(0, 150);
  if (!q) return res.status(400).json({ error: 'Enter a search term' });
  if (!connectionString || connectionString.includes('[SENSITIVE]')) {
    return res.status(503).json({ error: 'Search database not configured' });
  }

  const terms = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 10);
  try {
    pool ||= new Pool({
      connectionString,
      max: 3,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
      query_timeout: 12000,
      ssl: { rejectUnauthorized: true }
    });

    const result = await pool.query(`
      SELECT p.url, p.title, p.description,
        (
          SELECT COALESCE(SUM(
            CASE WHEN p.title ILIKE '%' || term || '%' THEN 12 ELSE 0 END +
            CASE WHEN p.description ILIKE '%' || term || '%' THEN 5 ELSE 0 END +
            CASE WHEN p.content ILIKE '%' || term || '%' THEN 1 ELSE 0 END
          ), 0)
          FROM unnest($1::text[]) AS term
        ) AS score
      FROM public.bubbles_pages AS p
      WHERE EXISTS (
        SELECT 1 FROM unnest($1::text[]) AS term
        WHERE p.title ILIKE '%' || term || '%'
           OR p.description ILIKE '%' || term || '%'
           OR p.content ILIKE '%' || term || '%'
      )
      ORDER BY score DESC, p.url ASC
      LIMIT 30
    `, [terms]);

    const count = await pool.query('SELECT COUNT(*)::integer AS total FROM public.bubbles_pages');
    return res.status(200).json({
      pages: result.rows.map(({ url, title, description }) => ({ url, title, description })),
      total: count.rows[0].total
    });
  } catch (err) {
    console.error('Bubbles search failed:', err.message);
    return res.status(503).json({ error: 'Search temporarily unavailable' });
  }
}
