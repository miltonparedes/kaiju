import { Command } from 'commander';

export const fetchCommand = new Command('fetch')
  .description('Fetch a pull request for analysis')
  .argument('<pr-url>', 'URL of the pull request')
  .option('-p, --provider <provider>', 'Git provider', 'github')
  .action((prUrl, options) => {
    console.log(`Fetching PR: ${prUrl} (provider: ${options.provider})`);
  });
