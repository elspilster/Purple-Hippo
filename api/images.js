import pg from 'pg';
const { Pool } = pg;
const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
let pool;
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') return res.status(405).json({error:'Method not allowed'});
  const q = String(req.query.q || '').trim().slice(0,150);
  if (!q) return res.status(400).json({error:'Enter a search term'});
  if (!connectionString) return res.status(503).json({error:'Image database not configured'});
  try {
    pool ||= new Pool({connectionString,max:3,connectionTimeoutMillis:5000,idleTimeoutMillis:10000,ssl:{rejectUnauthorized:true}});
    const exists = await pool.query("SELECT to_regclass('public.bubbles_images') AS name");
    if (!exists.rows[0].name) return res.status(200).json({images:[],total:0});
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0,10);
    const matches = await pool.query(`
      SELECT image_url, page_url, alt, title,
      (SELECT COALESCE(SUM(CASE WHEN lower(coalesce(i.alt,'')) LIKE '%'||term||'%' THEN 10 ELSE 0 END +
        CASE WHEN lower(coalesce(i.title,'')) LIKE '%'||term||'%' THEN 5 ELSE 0 END +
        CASE WHEN lower(coalesce(i.page_url,'')) LIKE '%'||term||'%' THEN 1 ELSE 0 END),0)
       FROM unnest($1::text[]) AS term) AS score
      FROM bubbles_images i
      ORDER BY score DESC, image_url ASC LIMIT 100
    `,[terms]);
    const images=matches.rows.filter(r=>Number(r.score)>0).slice(0,60).map(({image_url,page_url,alt,title})=>({image_url,page_url,alt,title}));
    const count=await pool.query('SELECT COUNT(*)::integer AS total FROM bubbles_images');
    return res.status(200).json({images,total:count.rows[0].total});
  } catch(err) {
    console.error('Bubbles image search failed:',err.message);
    return res.status(503).json({error:'Image search temporarily unavailable'});
  }
}
