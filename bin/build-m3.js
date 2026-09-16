import * as esbuild from 'esbuild';

async function build() {
  console.log('Building Material Web bundle...');
  await esbuild.build({
    entryPoints: ['public/js/vendor/m3-entry.js'],
    bundle: true,
    minify: true,
    format: 'esm',
    target: ['es2020'],
    outfile: 'public/js/vendor/material-web.bundle.js',
  });
  console.log('Material Web bundle built successfully at public/js/vendor/material-web.bundle.js');
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
