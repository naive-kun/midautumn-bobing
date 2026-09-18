import { build } from 'vite';

// The public Pages build is self-contained and never needs a room server.
process.env.VITE_PLAY_MODE = 'solo';
await build({ mode: 'pages', base: process.env.VITE_BASE_PATH || './' });
