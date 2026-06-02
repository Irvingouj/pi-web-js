var URL = globalThis.URL;
var URLSearchParams = globalThis.URLSearchParams;
var path = {
  dirname: function(p) { var s = String(p); var i = s.lastIndexOf('/'); return i <= 0 ? '/' : s.slice(0, i); },
  join: function(...parts) { var segs = []; for (var part of parts) for (var seg of String(part).split('/')) if (seg !== '') segs.push(seg); return '/' + segs.join('/'); },
  basename: function(p) { var parts = String(p).split('/'); return parts[parts.length - 1] || ''; }
};
var setTimeout = globalThis.setTimeout;
var setInterval = globalThis.setInterval;
var clearTimeout = globalThis.clearTimeout;
var clearInterval = globalThis.clearInterval;
var localStorage = globalThis.localStorage;
var sessionStorage = globalThis.sessionStorage;
var document = globalThis.document;
var window = globalThis.window;
var navigator = globalThis.navigator;
var crypto = globalThis.crypto;

var __makeAsyncCache = {};
function makeAsync(action, fields) {
  var cacheKey = action + (fields ? '|' + fields.join(',') : '');
  if (__makeAsyncCache[cacheKey]) return __makeAsyncCache[cacheKey];
  var fn = function(...args) {
    return new Promise((resolve, reject) => {
      let params;
      if (args.length === 0) params = {};
      else if (args.length === 1) params = args[0];
      else params = args;
      if (fields && Array.isArray(params)) {
        var obj = {};
        for (var i = 0; i < fields.length && i < params.length; i++) obj[fields[i]] = params[i];
        params = obj;
      } else if (fields && (typeof params === 'string' || typeof params === 'number')) {
        var obj = {}; obj[fields[0]] = params; params = obj;
      }
      __webJsTriggerAsync(action, params, resolve, reject);
    });
  };
  __makeAsyncCache[cacheKey] = fn;
  return fn;
}
function __webJsSetupAsyncBindings(specs) {
  for (const spec of specs) {
    var ns = globalThis;
    var parts = spec.namespace.split('.');
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      if (!ns[part]) ns[part] = {};
      ns = ns[part];
    }
    if (typeof ns[spec.name] === 'undefined') {
      ns[spec.name] = makeAsync(spec.action, spec.fields);
    }
  }
}
