import { Command } from 'commander';

export const splitCommand = new Command('split')
  .description('Split a pull request into reviewable chunks')
  .argument('<pr-id>', 'ID of the pull request to split')
  .option('-s, --strategy <strategy>', 'Splitting strategy', 'auto')
  .option('-m, --max-files <number>', 'Maximum files per chunk', '10')
  .action((prId, options) => {
    console.log(
      `Splitting PR ${prId} (strategy: ${options.strategy}, max-files: ${options.maxFiles})`,
    );
  });
