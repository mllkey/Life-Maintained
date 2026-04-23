const { getSentryExpoConfig } = require('@sentry/react-native/metro');

const config = getSentryExpoConfig(__dirname);

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
