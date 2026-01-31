/**
 * Vitest setup file
 * Loads environment variables from .env.development
 */

import { config } from 'dotenv';

// Load environment variables from .env.development
config({ path: '.env.development' });
