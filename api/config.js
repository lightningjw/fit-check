// Public client config. The anon key is designed to be public; row-level security does the protecting.
// Accept a pasted URL with a path (e.g. .../rest/v1/) and keep only the origin.
const origin = u => { try { return new URL(String(u || '').trim()).origin; } catch (e) { return ''; } };

module.exports = (req, res) => {
  res.setHeader('cache-control', 'public, max-age=300');
  res.status(200).json({
    supabaseUrl: origin(process.env.SUPABASE_URL),
    supabaseAnonKey: (process.env.SUPABASE_ANON_KEY || '').trim(),
  });
};
