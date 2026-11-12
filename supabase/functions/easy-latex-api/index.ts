// Regenerate backend.generated.js and deno.json with npm run supabase:build.
import { createSupabaseEmailRuntime } from './backend.generated.js';

const runtime = createSupabaseEmailRuntime(Deno.env.toObject());
Deno.serve(request => runtime.fetch(request));
addEventListener('beforeunload', () => { void runtime.close(); });
