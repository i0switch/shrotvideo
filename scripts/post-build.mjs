import fs from 'fs';
import path from 'path';

const indexPath = path.resolve(process.cwd(), 'dist/renderer/index.html');

try {
  let html = fs.readFileSync(indexPath, 'utf-8');
  console.log('Original index.html content read.');

  // Replace absolute paths with relative paths
  html = html.replace(/src="\/assets/g, 'src="./assets');
  html = html.replace(/href="\/assets/g, 'href="./assets');

  fs.writeFileSync(indexPath, html, 'utf-8');
  console.log('Successfully updated asset paths in index.html to be relative.');
} catch (error) {
  console.error('Error processing index.html:', error);
  process.exit(1);
}
