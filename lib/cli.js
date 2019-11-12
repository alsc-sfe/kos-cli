'use strict';

const debug = require('debug')('kos:cli');
const path = require('path');
const colors = require('colors/safe');
const semver = require('semver');

let kosConfig = null;
let dotenv = null;
let rawArgv = null;
let argv = null;

let corePkg = null;

const pkg = require('../package.json');
debug('cliPkg: %o', pkg);

module.exports = cli;

/***
 *
 * @param passedArgv
 * @returns {Promise}
 */
function cli(passedArgv){
  rawArgv = passedArgv || process.argv;
  debug('rawArgv: %o', rawArgv);

  // root check
  if (process.env.KOS_ALLOW_SUDO) {
    console.log('root privileges downgrade skipped');
  } else {
    require('root-check')(
      '\n' +
      colors.red('请不要用 `sudo` 执行 kos 命令.') + '\n\n' +
      '如果你不使用 sudo 不能正确执行命令，可能是你安装的时候出现了权限问题'
    );
  }

  // userhome check.
  const userHome = require('./userhome')();
  if (!userHome) {
    console.error(colors.red('ERROR: can not find HOME directory.'));
    process.exit(1);
  }

  // argv parsing
  argv = require('minimist')(rawArgv.slice(2));
  debug('argv: %o', argv);

  // kos config
  kosConfig = {
    'home': path.join(userHome, '.kos'),
    'registry': 'http://registry.npmjs.org/', // 不同公司不同registry || 统一npm registry
    'nodeUsed': 'bundle'
  };

  // load dot env
  dotenv = require('dotenv');
  /*
   * .env
   *   KOS_HOME=~/.kos
   *   KOS_ENV=local|dev|prepub|prod
   *   KOS_REGISTRY=
   *
   *   KOS_CORE_PATH=
   *
   *   KOS_NOTIFY=on|off
   *
   *   KOS_TRACK=on|off
   *   KOS_ERROR_LOG=on|off
   *   KOS_DAEMON_LOG=on|off
   *
   *   KOS_NODE_USED=
   */
  dotenv.config({
    'path': path.join(kosConfig.home, '.env'),
    'silent': true
  });

  if (process.env.KOS_HOME) {
    kosConfig['home'] = process.env.KOS_HOME;
  }
  if (process.env.KOS_ENV) {
    kosConfig['env'] = process.env.KOS_ENV;
  }
  if (process.env.KOS_REGISTRY) {
    kosConfig['registry'] = process.env.KOS_REGISTRY;
  }
  if (process.env.KOS_NODE_USED) {
    kosConfig['nodeUsed'] = process.env.KOS_NODE_USED;
  }
  debug('kosConfig: %o', kosConfig);

  const info = {
    'coreName': '@saas/kos-core',
    'coreRoot': path.join(kosConfig['home'], '.core'),
    'coreTrash': path.join(kosConfig['home'], '.trash')
  };
  info.corePath = path.join(info.coreRoot, 'node_modules', info.coreName);
  if (process.env.KOS_CORE_PATH) {
    info.corePath = process.env.KOS_CORE_PATH;
  }
  debug('info: %o', info);

  const cmd = argv._[0];
  debug('cmd: %o', cmd);

  // run
  return prepare('run', info)
  .then((p) => {
    // to delete opmi
    console.log('p', p);
    return run(p)
  })
  .catch(error => {
    console.log(error);
  });
}

/***
 * 确认 CORE 已安装好，是否需要更新
 * @param action
 * @param opts
 * @returns {Promise}
 */
async function prepare(action, opts){
  debug('do prepare');

  // TODO cli update notify 

  // read kos-core package.json
  const start = Date.now();
  debug('prepare opts: %o', opts);
  try {
    corePkg = await readJson(path.join(opts.corePath, 'package.json'));
  } catch(e) {}
  if (!corePkg) {
    corePkg = {};
  }
  debug('corePkg: %o', corePkg);

  // read the version from local store
  let coreVersion = corePkg.version, coreBeta = false;
  let storeData, storeRes;
  try {
    storeData = await readJson(path.join(kosConfig['home'], 'kos_modules', '.store.json'));
  } catch(e) {}
  if (storeData && storeData.mods && storeData.mods[opts.coreName]) {
    const coreData = storeData.mods[opts.coreName];
    debug('coreData from local: %o;', coreData);

    if (semver.valid(coreData.version)) {
      coreVersion = coreData.version;
    }
    if (coreData.is_next && semver.valid(coreData.next_version)) {
      coreVersion = coreData.next_version;
      coreBeta = true;
    }
  } else {
    if (corePkg.name && corePkg.version) { // 不是首次安装，检查更新时
      try {
        storeRes = await require('got').get(
          kosConfig.registry + '/' + opts.coreName + '/latest',
          {'json': true, 'timeout': 60 * 1000, 'retries': 0}
        );
        if (storeRes && storeRes.body) {
          debug('coreData from io: %o', storeRes.body);
          if (storeRes.body.version) {
            coreVersion = storeRes.body.version;
          }
        }
      } catch(e) {}
    }
  }
  debug('version: %s; beta: %s', coreVersion, coreBeta);

  if (!corePkg.name || !corePkg.version) { // 首次安装core
    debug('new install core');
    if (!coreVersion) {
      coreVersion = 'latest';
    }
    console.log(colors.yellow('开始自动全量安装 Core' + format(coreVersion, coreBeta)));
    await install(opts.coreName, coreVersion, {
      'root': opts.coreRoot,
      'trash': opts.coreTrash
    });
  } else { // 非首次安装core， 更新
    const diffLevel = 'major';
    const levels = ['patch', 'minor', 'major'];
    const diff = semver.diff(coreVersion, corePkg.version);
    debug('coreDiff: %s', diff);
    if (diff && semver.gt(coreVersion, corePkg.version)) {
      let type = 'compatible';
      let a = levels.indexOf(diffLevel);
      if (a != -1) {
        let b = -1;
        for (let i = 0, len = levels.length; i < len; i += 1) {
          if (diff == levels[i] || diff == ('pre' + levels[i])) {
            b = i;
          }
        }
        if (b - a >= 0) {
          type = 'incompatible';
        }
      }

      let doInstall = false;
      if (type == 'compatible') {
        console.log(colors.yellow('开始自动增量升级 Core' + format(corePkg.version + ' -> ' + coreVersion, coreBeta)));
        doInstall = true;
      } else {
        const yes = await confirm(
          'Core 已升级到 ' + colors.green(coreVersion) +
            '，本地版本是 ' + colors.dim(corePkg.version) + '，建议升级。' +
            '确认升级？[y/n] '
        );
        if (yes) {
          console.log(colors.yellow('开始升级 Core' + format(corePkg.version + ' -> ' + coreVersion, coreBeta)));
          doInstall = true;
        }
      }

      if (doInstall) {
        await install(opts.coreName, coreVersion, {
          'root': opts.coreRoot,
          'trash': opts.coreTrash
        });
      }
    }
  }
  debug('prepare done, using: %ds', (Date.now() - start) / 1000);

  return new Promise(resolve => {
    resolve(opts.corePath);
  });

  async function install(name, version, opts) {
    const fs = require('../lib/fs');

    debug('install core start');
    const start = Date.now();

    const pkgFile = path.join(opts.root, 'node_modules', name, 'package.json');

    // check lock
    const lockFile = path.join(opts.root, '.lock');
    const exists = await fs.existsAsync(lockFile);
    console.log('lockFile', lockFile);
    if (exists && !opts.force) {
      let err = new Error('module is locked');
      err.type = '_lock';
      throw err;
    }

    let cleared = false;
    let succeed = false;

    // lock
    await fs.ensureFileAsync(lockFile);
    require('on-exit')(clear);

    try {
      await _install(name, version, opts, fs);
    } catch(e) {
      clear();

      e.type = '_install';
      throw e;
    }

    // console.log(colors.yellow('开始检查 Core 依赖完整度，请等待...'));
    // try {
    //   await check(path.join(opts.root, 'node_modules', name));
    // } catch(e) {
    //   clear();

    //   e.type = '_check';
    //   throw e;
    // }

    // read pkg again.
    try {
      corePkg = await readJson(path.join(opts.root, 'node_modules', name, 'package.json'));
    } catch(e) {}
    if (!corePkg) {
      corePkg = {};
    }
    debug('new corePkg: %o', corePkg);
    if (corePkg.kos && corePkg.kos.node) {
      kosConfig.nodeVersion = corePkg.kos.node;
    }

    console.log(colors.yellow('开始应用 v' + kosConfig.nodeVersion + ' 的 Node 环境，请等待...'));
    try {
      await _installNode();
    } catch(e) {
      console.error(colors.red('下载 node 包失败，降级使用系统 node：' + e.message));
    }

    // mark install to success
    succeed = true;
    clear();

    console.log(colors.yellow('操作完成，耗时：' + (Date.now() - start) / 1000 + 's'));
    debug('install core done');

    function clear() {
      if (!cleared) {
        debug('clear, lockfile: %s; succeed: %s; pkgfile: %s', lockFile, succeed, pkgFile);
        try {
          // unlock
          fs.unlinkSync(lockFile);
          if (!succeed) {
            // if install fail, rollback
            fs.unlinkSync(pkgFile);
          }
        } catch(e) {
          debug('clear error', e.message);
        }
        cleared = true;
      } else {
        debug('already cleared');
      }
    }
  }

  async function _install(name, version, opts, fs) {
    const installer = require('../lib/installer');

    const realDir = path.join(opts.root, 'node_modules');

    let t = Date.now();
    const exists = await fs.existsAsync(realDir);
    if (exists) {
      if (process.platform == 'win32') {
        debug('use remove');
        await fs.removeAsync(realDir);
      } else {
        debug('use move');
        const trashPath = opts.trash + '_core_' + t;
        await fs.moveAsync(realDir, trashPath);
        require('../lib/trash')(trashPath);
      }
    }
    debug('trash using: %ds', (Date.now() - t) / 1000);

    t = Date.now();
    await installer({
      'registry': kosConfig['registry'],
      'root': opts.root,
      'pkgs': [{'name': name, 'version': version}]
    });
    debug('install using: %ds', (Date.now() - t) / 1000);
  }

  async function _installNode() {
    const t = Date.now();
    await require('./install-node')({
      'version': kosConfig.nodeVersion,
      'storeDir': path.join(kosConfig.home, '.node'),
      'nodeDir': path.join(kosConfig.home, '.node', 'node')
    });
    debug('install-node using: %ds', (Date.now() - t) / 1000);
  }

  function format(v, b) {
    let s = '（' + v;
    if (b != null) {
      s += '；' + (b ? '灰度版本' : '正式版本');
    }
    s += '），请等待...';
    return s;
  }
}

/**
 *
 * @param corePath
 */
async function run(corePath) {
  let currentNode = await getCurrentNode(path.join(kosConfig.home, '.node', 'node'));
  debug('currentNode: %j', currentNode);

  if (kosConfig.nodeUsed == 'system') {
    debug('use the system node by force');
  } else {
    if (currentNode.used == 'bundle') {
      debug('use the bundle node');

      // set the right nodePath
      rawArgv[0] = currentNode.bundleNode;

      // set the env.PATH for correct search
      process.env.PATH = [path.dirname(currentNode.bundleNode), process.env.PATH].join(path.delimiter);
    } else {
      debug('use the system node by fallback');
    }
  }

  const coreFile = process.platform == 'win32' ? corePath.replace(/\\/g, '\\\\') : corePath;
  const coreConfigStr = JSON.stringify({
    'home': kosConfig.home,
    'registry': kosConfig.registry,
    'env': kosConfig.env
  });
  const coreOptsStr = JSON.stringify({
    'clipkg': {'name': pkg.name, 'version': pkg.version},
    'argv': rawArgv,
    'nodeVersion': {
      'system': currentNode.systemVer,
      'bundle': currentNode.bundleVer,
      'use': currentNode.used
    }
  });
  // 执行 core
  const coreCode = 'new (require("' + coreFile + '"))(' + coreConfigStr + ').start(' + coreOptsStr + ')';
  debug('run with code: %s', coreCode);

  const p = spawnCommand('node', ['-e', coreCode], {'stdio': 'inherit'});
  p.on('error', e => {
    debug('spawn error', e);
    error(e);
    process.exit(1);
  });
  p.on('exit', c => {
    debug('spawn exit', c);
    process.exit(c);
  });
}

/**
 * 
 * @param nodeDir
 * @returns {Object}
 */
async function getCurrentNode(nodeDir) {
  let nodeBin = nodeDir;
  if (process.platform == 'win32') {
    nodeBin = path.join(nodeBin, 'node.exe');
  } else {
    nodeBin = path.join(nodeBin, 'bin/node');
  }

  const bundleNodeVer = await _version(nodeBin);
  const systemNodeVer = process.version;

  return {
    'bundleVer': bundleNodeVer,
    'bundleNode': nodeBin,
    'systemVer': systemNodeVer,
    'systemNode': 'node',
    'used': bundleNodeVer ? 'bundle' : 'system'
  };

  function _version(n) {
    return new Promise((resolve, reject) => {
      require('child_process').exec(n + ' -v', (err, stdout, stderr) => {
        stdout = String(stdout).trim();
        if (semver.valid(stdout)) {
          return resolve(stdout);
        }
        return resolve('');
      });
    });
  }
}

/**
 *
 * @param msg
 * @returns {Promise}
 */
function confirm(msg) {
  return new Promise(function resolver(resolve, reject) {
    process.stdin.setEncoding('utf8');
    process.stdin.resume();

    process.stdout.write(msg);
    process.stdin.once('data', function(data) {
      const choice = data.trim().toLowerCase();
      if (choice == 'y' || choice == '') {
        resolve(true);
      } else {
        resolve(false);
      }
      process.stdin.pause();
    });
  });
}

/**
 *
 * @param file
 * @param encoding
 * @returns {Promise}
 */
function readJson(file, encoding) {
  return new Promise((resolve, reject) => {
    require('fs').readFile(file, encoding || 'utf8', (err, content) => {
      if (err) {
        reject(err);
      } else {
        try {
          content = JSON.parse(content);
          resolve(content);
        } catch(e) {
          reject(e);
        }
      }
    });
  });
}

/**
 *
 * @param command
 * @param args
 * @param options
 * @returns {Object}
 */
function spawnCommand(command, args, options) {
  const win32 = process.platform === 'win32';

  const cmd = win32 ? 'cmd' : command;
  const cmdArgs = win32 ? ['/c'].concat(command, args) : args;

  return require('child_process').spawn(cmd, cmdArgs, options || {});
}