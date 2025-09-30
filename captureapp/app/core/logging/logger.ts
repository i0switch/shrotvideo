import path from 'path';
import fs from 'fs';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const log = (process.versions.electron ? require('electron-log') : require('electron-log/node')) as typeof import('electron-log');

type PathVariables = {
  appName?: string;
};

const baseLogDir = path.resolve(process.cwd(), 'logs');
const categories = ['build', 'e2e', 'compose', 'download', 'app'] as const;

for (const category of categories) {
  const dir = path.join(baseLogDir, category);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export const appLogger = log.create({ logId: 'app' });
appLogger.transports.file.resolvePathFn = () => path.join(baseLogDir, 'app', 'app.log');

export function createLogger(name: string) {
  const categoryLog = log.create({ logId: name });
  categoryLog.transports.file.level = 'info';
  categoryLog.transports.console.level = 'info';
  categoryLog.transports.file.resolvePathFn = (variables: PathVariables) => {
    const safeName = name.replace(/[^a-z0-9\-_.]/gi, '_');
    const dir = path.join(baseLogDir, safeName);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const appName = variables.appName ?? 'captureapp';
    return path.join(dir, `${appName}.log`);
  };
  return categoryLog;
}
