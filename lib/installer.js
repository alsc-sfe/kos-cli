'use strict';
const debug = require('debug')('kos:installer');
const execSync = require('child_process').execSync;
const npmii = require('npminstall');
const co = require('co');


const TIMEOUT = 10 * 60 * 1000;


module.exports = async function (opts) {
  debug('starting installer opts', opts);
  const utils = require('npminstall/lib/utils');

  const env = {};
  env['npm_config_registry'] = opts.registry;
  env['npm_node_execpath'] = env.NODE = process.env.NODE || process.execPath;
  env['npm_execpath'] = require.main.filename;

  // set node-gyp env for windows.
  if (process.platform == 'win32') {
    let python = getPython();
    let msvsVersion = getMsvsVersion();
    if (python) {
      env['npm_config_python'] = python;
    }
    if (msvsVersion) {
      env['npm_config_msvs_version'] = msvsVersion;
    }
  }

  // set mirror env.
  // const binaryMirros = await utils.getBinaryMirrors(opts.registry);
  // for (let key in binaryMirros.ENVS) {
  //   env[key] = binaryMirros.ENVS[key];
  // }
  debug('starting installer env', env);


  // no proxy
  process.env.NO_PROXY = '*';

  await co(function* () {
    yield npmii({
      'production': true,
      'registry': opts.registry,
      'timeout': opts.timeout || TIMEOUT,
      'ignoreScripts': false,
      'root': opts.root,
      // 'pkgs': [ { name: 'co', version: 'latest' } ],
      'pkgs': opts.pkgs
    });
  }).catch(err => {
    debug('npmii err:',err.stack);
  });
};

function getPython() {
  try {
    return execSync('npm config get python').toString().trim();
  } catch (err) {
    console.error('exec npm config get python ERROR:' + err.message);
  }
  return '';
}

function getMsvsVersion() {
  try {
    return execSync('npm config get msvs_version').toString().trim();
  } catch (err) {
    console.error('exec npm config get msvs_version ERROR:' + err.message);
  }
  return '';
}

