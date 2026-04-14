import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://nhzkvszvulfvjssfoqxm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5oemt2c3p2dWxmdmpzc2ZvcXhtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxNTg2NzgsImV4cCI6MjA5MTczNDY3OH0.EZlZvzuWFHPo2qwz2OFnGYpPcXjDFzyIUKdLwntLhgk';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
