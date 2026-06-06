if (!globalThis.URL) {
  globalThis.URL = function URL(href, base) {
    var str = String(href);
    if (base !== undefined) {
      var baseUrl = new globalThis.URL(String(base));
      if (!str.includes('://')) {
        if (str.startsWith('/')) str = baseUrl.origin + str;
        else str = baseUrl.origin + baseUrl.pathname.replace(/\/[^/]*$/, '/') + str;
      }
    }
    var match = str.match(/^([^:]+:)\/\/([^/?#]*)([^?#]*)?(\?[^#]*)?(#.*)?$/);
    if (!match) throw new TypeError('Invalid URL');
    this.href = str;
    this.protocol = match[1];
    this.host = match[2];
    var hp = match[2].split(':');
    this.hostname = hp[0];
    this.port = hp[1] || '';
    this.pathname = match[3] || '/';
    this.search = match[4] || '';
    this.hash = match[5] || '';
    this.origin = this.protocol + '//' + this.host;
  };
}
if (!globalThis.URLSearchParams) {
  globalThis.URLSearchParams = function URLSearchParams(init) {
    this._pairs = [];
    if (init && typeof init === 'object') {
      for (var key in init) {
        if (Object.prototype.hasOwnProperty.call(init, key)) {
          this._pairs.push([key, String(init[key])]);
        }
      }
    } else if (typeof init === 'string') {
      var qs = init.startsWith('?') ? init.slice(1) : init;
      if (qs) {
        for (var part of qs.split('&')) {
          var eq = part.indexOf('=');
          if (eq < 0) this._pairs.push([decodeURIComponent(part), '']);
          else this._pairs.push([decodeURIComponent(part.slice(0, eq)), decodeURIComponent(part.slice(eq + 1))]);
        }
      }
    }
  };
  globalThis.URLSearchParams.prototype.toString = function() {
    return this._pairs.map(function(p) {
      return encodeURIComponent(p[0]) + '=' + encodeURIComponent(p[1]);
    }).join('&');
  };
}
var URL = globalThis.URL;
var URLSearchParams = globalThis.URLSearchParams;
var path = {
  dirname: function(p) { var s = String(p); var i = s.lastIndexOf('/'); return i <= 0 ? '/' : s.slice(0, i); },
  join: function(...parts) { var segs = []; for (var part of parts) for (var seg of String(part).split('/')) if (seg !== '') segs.push(seg); return '/' + segs.join('/'); },
  basename: function(p) { var parts = String(p).split('/'); return parts[parts.length - 1] || ''; },
  extname: function(p) { var base = path.basename(p); var i = base.lastIndexOf('.'); return i <= 0 ? '' : base.slice(i); },
  normalize: function(p) {
    var segs = [];
    for (var seg of String(p).split('/')) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') { if (segs.length) segs.pop(); continue; }
      segs.push(seg);
    }
    var abs = String(p).startsWith('/');
    return (abs ? '/' : '') + segs.join('/');
  },
  isAbsolute: function(p) { return String(p).startsWith('/'); },
  resolve: function(...parts) {
    var resolved = '';
    for (var i = parts.length - 1; i >= 0; i--) {
      var part = String(parts[i]);
      resolved = part + (resolved ? '/' + resolved : '');
      if (path.isAbsolute(part)) break;
    }
    return path.normalize(resolved);
  },
  relative: function(from, to) {
    from = path.normalize(from);
    to = path.normalize(to);
    var fromParts = from.split('/').filter(function(s) { return s !== ''; });
    var toParts = to.split('/').filter(function(s) { return s !== ''; });
    var i = 0;
    while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) i++;
    var rel = [];
    for (var j = i; j < fromParts.length; j++) rel.push('..');
    for (var k = i; k < toParts.length; k++) rel.push(toParts[k]);
    return rel.join('/') || '.';
  }
};
var setTimeout = globalThis.setTimeout;
var setInterval = globalThis.setInterval;
var clearTimeout = globalThis.clearTimeout;
var clearInterval = globalThis.clearInterval;
var localStorage = globalThis.localStorage;
var sessionStorage = globalThis.sessionStorage;
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
  if (typeof globalThis.fetch === 'undefined' && typeof web !== 'undefined' && typeof web.fetch === 'function') {
    globalThis.fetch = web.fetch;
  }
}
