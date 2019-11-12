'use strict';

const debug = require('debug')('kos:install-node');
const registryUrl = 'https://npm.taobao.org/mirrors/node';
const platform = process.platform;
const arch = process.arch;

const downloadOpts = {
  'retries': 0,
  'timeout': 10 * 60 * 1000 // 10min
};

module.exports = async function (opts) {
  opts = opts || {};

  await _download();
  
  try {
    await require('./fs').removeAsync(
      require('path').join(opts.storeDir, getSuffix(platform, arch, opts.version))
    );
  } catch(e) {}

  function _download() {
    return new Promise((resolve, reject) => {
      let nodeBin = opts.nodeDir;
      if (platform == 'win32') {
        nodeBin = require('path').join(nodeBin, 'node.exe');
      } else {
        nodeBin = require('path').join(nodeBin, 'bin/node');
      }
      require('child_process').exec(nodeBin + ' -v', (err, stdout, stderr) => {
        stdout = String(stdout).trim();
        debug('nodeBin: %o', stdout);
        if (stdout == 'v' + opts.version) {
          return resolve(nodeBin);
        }

        const download = require('download');
        const tar = require('tar');
        const zlib = require('zlib');

        let downloadUrl = registryUrl + '/v' + opts.version;
        downloadUrl += getSuffix(platform, arch, opts.version);

        if (platform == 'win32') {
          download(downloadUrl, opts.nodeDir, downloadOpts)
            .then(() => resolve(nodeBin))
            .catch(reject);
        } else {
          const gunzip = zlib.createGunzip();
          gunzip.on('error', reject);

          const extracter = tar.Extract({'path': opts.nodeDir, 'strip': 1});
          extracter.on('error', reject);
          extracter.on('end', () => resolve(nodeBin));

          const p = download(downloadUrl, opts.storeDir, downloadOpts);
          p.catch(reject);
          p.pipe(gunzip).pipe(extracter);
        }
      });
    });
  }

  function getSuffix(platform, arch, version) {
    let suffix = '';
    if (platform == 'win32') {
      suffix += '/win-' + arch;
      suffix += '/node.exe';
    } else {
      suffix += '/node-v' + version + '-' + platform + '-' + arch + '.tar.gz';
    }
    return suffix;
  }
};