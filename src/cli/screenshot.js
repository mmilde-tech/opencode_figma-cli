import exportCommand from './export.js';

// Screenshot is just a PNG export of the selected/given node at @2x.
export default async function screenshotCommand(nodeId, options) {
  return exportCommand('png', nodeId, {
    scale: options.scale || 2,
    output: options.output || null
  });
}
