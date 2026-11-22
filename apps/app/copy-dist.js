const fs = require('fs');
const path = require('path');

const src = path.resolve(__dirname, 'dist');
if (fs.existsSync(src)) {
  const targets = [
    path.resolve(__dirname, '../../dist'),
    path.resolve(__dirname, 'apps/app/dist'),
  ];
  for (const target of targets) {
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.cpSync(src, target, { recursive: true });
      console.log('Synced dist to:', target);
    } catch (e) {
      // Ignore
    }
  }
}
