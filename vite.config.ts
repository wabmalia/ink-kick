import { defineConfig } from 'vitest/config';

// Relative base so the build works under any GitHub Pages path.
export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      // The game, and the lab: built too, but not linked from the game.
      input: { main: 'index.html', lab: 'lab.html' },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    // Run courier through Vitest rather than Node, which can't load PeerJS
    // as an ES module (and so mocks of it apply).
    server: { deps: { inline: ['@wabmalia/courier'] } },
  },
});
