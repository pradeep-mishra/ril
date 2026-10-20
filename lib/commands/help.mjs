import { RilError } from '../errors.mjs';

export default {
  name: 'help',
  summary: 'List the commands, or show how to use one.',
  usage: 'ril help [command]',
  run(ctx, argv) {
    const [which] = argv;
    if (which) {
      const found = ctx.commands.find((c) => c.name === which);
      if (!found) throw new RilError(`There is no command called ${which}.`, { next: 'run ril help to see the list' });
      ctx.out(ctx.json ? JSON.stringify({ name: found.name, summary: found.summary, usage: found.usage }) : `${found.summary}\nUsage: ${found.usage}`);
      return;
    }
    if (ctx.json) {
      ctx.out(JSON.stringify({ commands: ctx.commands.map(({ name, summary }) => ({ name, summary })) }));
      return;
    }
    const width = Math.max(...ctx.commands.map((c) => c.name.length));
    ctx.out(['ril keeps track of a project from idea to proven software.', '', ...ctx.commands.map((c) => `  ${c.name.padEnd(width)}  ${c.summary}`), '', 'Options for every command: --dir <folder>, --json, --force "<reason>".'].join('\n'));
  },
};
