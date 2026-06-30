// Load environment variables for the standalone game server.
// Imported first in server/index.ts so credentials are available before the
// Supabase module initializes. Next.js loads .env.local on its own.
import { config } from "dotenv";

config({ path: ".env.local" });
config(); // fall back to .env
