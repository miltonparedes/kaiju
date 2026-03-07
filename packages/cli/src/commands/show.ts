import { Command } from 'commander';

export const showCommand = new Command('show')
  .description('Open the web UI to visualize PR chunks')
  .option('-p, --port <port>', 'Port for the web server', '1954')
  .action((options) => {
    console.log(`Starting web UI on port ${options.port}`);
  });
