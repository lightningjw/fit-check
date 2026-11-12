// Public client config. The anon key is designed to be public; row-level security does the protecting.
module.exports = (req, res) => {
  res.setHeader('cache-control', 'public, max-age=300');
  res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  });
};
