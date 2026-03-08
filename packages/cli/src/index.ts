#!/usr/bin/env bun
import { Command } from 'commander';

import { catCommand } from './commands/cat.js';
import { fetchCommand } from './commands/fetch.js';
import { filesCommand } from './commands/files.js';
import { lsCommand } from './commands/ls.js';
import { showCommand } from './commands/show.js';
import { splitCommand } from './commands/split.js';
import { statusCommand } from './commands/status.js';

const program = new Command();

program.name('kaiju').description('Divide, visualize, and share giant PRs').version('0.0.0');

program.addCommand(fetchCommand);
program.addCommand(filesCommand);
program.addCommand(splitCommand);
program.addCommand(catCommand);
program.addCommand(statusCommand);
program.addCommand(lsCommand);
program.addCommand(showCommand);

program.parse();
