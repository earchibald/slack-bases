import esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian'],
  format: 'cjs',
  outfile: 'main.js',
  platform: 'node',
  sourcemap: 'inline',
});
