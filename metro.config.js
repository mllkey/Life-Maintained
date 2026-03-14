const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

const existingBlockList = Array.isArray(config.resolver.blockList)
  ? config.resolver.blockList
  : config.resolver.blockList
  ? [config.resolver.blockList]
  : [];

config.resolver.blockList = [
  ...existingBlockList,
  /\.local[/\\]state[/\\].*/,
];

module.exports = config;
