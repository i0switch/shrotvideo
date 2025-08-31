import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { ensureLogin } from './login';
import { grabLatestPosts } from './grab';

yargs(hideBin(process.argv))
  .command('login', 'Login to X', async () => {
    try {
      await ensureLogin();
    } catch (error) {
      console.error('Login failed:', error);
      process.exit(1);
    }
  })
  .command('grab', 'Grab latest posts', (yargs) => {
    return yargs
      .option('user', {
        alias: 'u',
        type: 'string',
        description: 'X user handle',
        required: true
      })
      .option('count', {
        alias: 'n',
        type: 'number',
        description: 'Number of posts to grab',
        default: 5
      })
      .option('outDir', {
        alias: 'o',
        type: 'string',
        description: 'Output directory',
        default: 'out/screenshots'
      });
  }, async (argv) => {
    try {
      const storageStatePath = await ensureLogin();
      await grabLatestPosts({
        user: argv.user,
        count: argv.count,
        outDir: argv.outDir,
        storageStatePath,
      });
    } catch (error) {
      console.error('Grab failed:', error);
      process.exit(1);
    }
  })
  .demandCommand(1, 'You need at least one command before moving on')
  .help()
  .argv;
