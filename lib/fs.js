'use strict';

const fs = require('fs-extra');
const slice = Array.prototype.slice;


// export fs promisified with bluebird
module.exports = factory(fs, Promise);


/**
 * Factory to create promisified version of fs-extra.
 * Adds promisified methods for all async methods
 * e.g. `fs.readFile(path, cb)` becomes `fs.readFileAsync(path)`
 * All original methods of `fs` and `fs-extra` modules are left untouched.
 * NB does not mutate `fs-extra` module - returns a new instance with extra methods added.
 *
 * @param {Object} fs - `fs-extra` module
 * @param {Object} Promise - Bluebird implementation to use
 * @returns {Object} - `fsExtra` with promisified methods added
 */
function factory(fs, Promise) {
  // clone fs-extra
  const fsOriginal = fs;
  fs = {};
  for (var methodName in fsOriginal) {
    fs[methodName] = fsOriginal[methodName];
  }

  // extend fs with isDirectory and isDirectorySync methods
  fs.isDirectory = function(path, callback) {
    fs.stat(path, function(err, stats) {
      if (err) return callback(err);

      callback(null, stats.isDirectory());
    });
  };

  fs.isDirectorySync = function(path) {
    return fs.statSync(path).isDirectory();
  };

  // promisify all methods
  // (except those ending with 'Sync', classes and various methods which do not use a callback)
  let method;
  for (methodName in fs) {
    method = fs[methodName];

    if (typeof method != 'function') continue;
    if (methodName.slice(-4) == 'Sync') continue;
    if (methodName.match(/^[A-Z]/)) continue;
    if (['exists', 'watch', 'watchFile', 'unwatchFile', 'createReadStream'].indexOf(methodName) != -1) continue;

    fs[methodName + 'Async'] = promisify(method);
  }

  // create fs.existsAsync()
  // fs.exists() is asynchronous but does not call callback with usual node (err, result) signature - uses just (result)
  fs.existsAsync = function(path) {
    return new Promise(function(resolve) {
      fs.exists(path, function(exists) {
        resolve(exists);
      });
    });
  };

  // return fs
  return fs;
}

/**
 *
 * @param original
 * @param settings
 * @returns {Function}
 */
function promisify(original, settings) {

  return function () {
    const args = slice.call(arguments);

    const returnMultipleArguments = settings && settings.multiArgs;

    let target;
    if (settings && settings.thisArg) {
      target = settings.thisArg;
    } else if (settings) {
      target = settings;
    }

    // Return the promisified function
    return new Promise(function (resolve, reject) {
      // Append the callback bound to the context
      args.push(function callback() {
        const values = slice.call(arguments);
        const err = values.shift();

        if (err) {
          return reject(err);
        }

        if (false === !!returnMultipleArguments) {
          return resolve(values[0]);
        }

        resolve(values);
      });

      // Call the function
      const response = original.apply(target, args);

      // If it looks like original already returns a promise,
      // then just resolve with that promise. Hopefully, the callback function we added will just be ignored.
      if (thatLooksLikeAPromiseToMe(response)) {
        resolve(response);
      }
    });
  };

  function thatLooksLikeAPromiseToMe(o) {
    return o && typeof o.then === 'function' && typeof o.catch === 'function';
  }
}