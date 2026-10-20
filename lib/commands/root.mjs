import { pluginRoot } from '../plugin-root.mjs';

export default {
  name: 'root',
  summary: 'Print the folder where this plugin is installed.',
  usage: 'ril root',
  run(ctx) {
    ctx.out(ctx.json ? JSON.stringify({ root: pluginRoot }) : pluginRoot);
  },
};
