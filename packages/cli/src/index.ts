#!/usr/bin/env bun
import { Command } from 'commander';

import { fetchCommand } from './commands/fetch.js';
import { showCommand } from './commands/show.js';
import { splitCommand } from './commands/split.js';

const program = new Command();

program.name('kaiju').description('Divide, visualize, and share giant PRs').version('0.0.0');

program.addCommand(fetchCommand);
program.addCommand(splitCommand);
program.addCommand(showCommand);

program.parse();
