#!/usr/bin/env node
const semver = require('semver');
const colors = require('colors/safe');

if(!semver.gt(process.version, '8.0.0')){
  console.log(colors.red('\nDEF 依赖 node 8.x 或以上版本，请升级本地的 node 环境\n'))
  return
}

require('../lib/cli')(process.argv);