import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let isLoaded = false;

export function loadEnv() {
  if (isLoaded) {
    return;
  }

  const nodeEnv = process.env.NODE_ENV || 'development';
  const envFile = nodeEnv === 'production' ? '.env.production' : '.env.development';
  const envPath = join(__dirname, '..', '..', envFile);

  const result = dotenv.config({ path: envPath, quiet: true });

  if (result.error || !process.env.SUPABASE_URL) {
    dotenv.config({ path: join(__dirname, '..', '..', '.env'), quiet: true });
  }

  isLoaded = true;
}

loadEnv();
