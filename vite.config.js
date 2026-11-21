import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

/** Every file under a folder, as paths relative to it. */
const filesIn = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? filesIn(p).map((q) => relative(dir, join(p, q))) : [f];
});

/**
 * Installable app: writes sw.js (from pwa/sw.js) into the build with the list of files to cache
 * for offline use, and a version that changes whenever any of them do.
 */
function pwa() {
  return {
    name: 'open-daw-pwa',
    apply: 'build',
    generateBundle(_, bundle) {
      const built = Object.values(bundle).map((f) => f.fileName).filter((f) => !f.endsWith('.map'));
      const files = ['./', ...built.filter((f) => f !== 'index.html'), ...filesIn('public')].sort();
      const hash = createHash('sha256');
      for (const f of Object.values(bundle)) hash.update(f.fileName).update(f.type === 'chunk' ? f.code : f.source);
      for (const f of filesIn('public')) hash.update(f).update(readFileSync(join('public', f)));
      const source = readFileSync('pwa/sw.js', 'utf8')
        .replace('self.__VERSION__', JSON.stringify(hash.digest('hex').slice(0, 12)))
        .replace('self.__PRECACHE__', JSON.stringify(files));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  plugins: [vue(), pwa()],
  base: './', // relative asset paths: works at any URL, e.g. GitHub Pages' /open-daw/
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    setupFiles: ['tests/setup.js'],
  },
});
