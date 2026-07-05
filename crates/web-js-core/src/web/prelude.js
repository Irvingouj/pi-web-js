// BigInt is not JSON-serializable in QuickJS. Zod schemas use bigintLike()
// which accepts bigint | number, but the WASM transport layer serializes
// params via JSON.stringify. Without this shim, any params object containing
// a BigInt (e.g. timeout: 15000n) causes JSON.stringify to throw TypeError,
// and js_value_to_json falls back to null → E_INVALID_PARAMS.
if (typeof BigInt.prototype.toJSON !== 'function') {
  BigInt.prototype.toJSON = function () { return Number(this); };
}
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
if (!globalThis.btoa || !globalThis.atob) {
  var base64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  globalThis.btoa = function btoa(str) {
    var bytes = [];
    for (var i = 0; i < str.length; i++) bytes.push(str.charCodeAt(i) & 0xff);
    var result = '';
    for (var i = 0; i < bytes.length; i += 3) {
      var b1 = bytes[i];
      var b2 = bytes[i + 1] || 0;
      var b3 = bytes[i + 2] || 0;
      result += base64chars[b1 >> 2];
      result += base64chars[((b1 & 0x03) << 4) | (b2 >> 4)];
      result += (i + 1 < bytes.length) ? base64chars[((b2 & 0x0f) << 2) | (b3 >> 6)] : '=';
      result += (i + 2 < bytes.length) ? base64chars[b3 & 0x3f] : '=';
    }
    return result;
  };
  globalThis.atob = function atob(str) {
    var lookup = {};
    for (var i = 0; i < base64chars.length; i++) lookup[base64chars[i]] = i;
    var result = '';
    var bytes = [];
    for (var i = 0; i < str.length; i++) {
      if (str[i] === '=') break;
      var val = lookup[str[i]];
      if (val === undefined) continue;
      bytes.push(val);
      if (bytes.length === 4) {
        result += String.fromCharCode((bytes[0] << 2) | (bytes[1] >> 4));
        result += String.fromCharCode(((bytes[1] & 0x0f) << 4) | (bytes[2] >> 2));
        result += String.fromCharCode(((bytes[2] & 0x03) << 6) | bytes[3]);
        bytes = [];
      }
    }
    if (bytes.length >= 2) result += String.fromCharCode((bytes[0] << 2) | (bytes[1] >> 4));
    if (bytes.length >= 3) result += String.fromCharCode(((bytes[1] & 0x0f) << 4) | (bytes[2] >> 2));
    return result;
  };
}
if (!globalThis.TextEncoder) {
  globalThis.TextEncoder = function TextEncoder() {};
  globalThis.TextEncoder.prototype.encode = function(str) {
    var bytes = [];
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i);
      if (code < 0x80) bytes.push(code);
      else if (code < 0x800) {
        bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      } else {
        bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      }
    }
    return new Uint8Array(bytes);
  };
}
if (!globalThis.TextDecoder) {
  globalThis.TextDecoder = function TextDecoder() {};
  globalThis.TextDecoder.prototype.decode = function(bytes) {
    var str = '';
    for (var i = 0; i < bytes.length; i++) {
      var byte = bytes[i];
      if (byte < 0x80) str += String.fromCharCode(byte);
      else if ((byte & 0xe0) === 0xc0) {
        str += String.fromCharCode(((byte & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
        i++;
      } else if ((byte & 0xf0) === 0xe0) {
        str += String.fromCharCode(((byte & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f));
        i += 2;
      }
    }
    return str;
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
function makeAsync(action, fields, parity) {
  var cacheKey = action + (fields ? '|' + fields.join(',') : '') + (parity ? '|parity' : '');
  if (__makeAsyncCache[cacheKey]) return __makeAsyncCache[cacheKey];
  var fn = function(...args) {
    return new Promise((resolve, reject) => {
      for (var i = 0; i < args.length; i++) {
        if (args[i] === undefined) {
          reject(new Error('E_INVALID_ARGUMENT_TRANSPORT: undefined arguments cannot be transported'));
          return;
        }
      }
      var params;
      if (parity) {
        params = args;
      } else if (fields) {
        if (args.length === 0) params = {};
        else if (args.length === 1) params = args[0];
        else if (
          fields.length === 1 &&
          args.length === 2 &&
          args[1] !== null &&
          typeof args[1] === 'object' &&
          !Array.isArray(args[1])
        ) {
          // (primaryArg, optionsObject) convention — e.g.
          // page.goto(url, { waitUntil: "networkidle" }). Merge the options
          // object into params; the positional primary arg takes precedence.
          params = Object.assign({}, args[1]);
          params[fields[0]] = args[0];
        } else params = args;
        if (Array.isArray(params)) {
          if (fields.length === 1 && fields[0] === 'fields') {
            if (params.every(function(item) { return typeof item === 'string'; })) {
              params = { fields: params };
            } else {
              reject(new Error('E_INVALID_ARGUMENT_TRANSPORT: fields array must contain only strings'));
              return;
            }
          } else {
            var obj = {};
            for (var j = 0; j < fields.length && j < params.length; j++) obj[fields[j]] = params[j];
            params = obj;
          }
        } else if (typeof params === 'string' || typeof params === 'number') {
          var named = {}; named[fields[0]] = params; params = named;
        }
      } else {
        if (args.length === 0) params = {};
        else if (args.length === 1) params = args[0];
        else params = args;
      }
      __webJsTriggerAsync(action, params, resolve, reject, (new Error()).stack);
    });
  };
  __makeAsyncCache[cacheKey] = fn;
  return fn;
}
function __webJsSetupAsyncBindings(specs) {
  // Track registered member names per leaf namespace for missing-API detection.
  var registeredByNamespace = {};
  for (const spec of specs) {
    var ns = globalThis;
    var parts = spec.namespace.split('.');
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      if (!ns[part]) ns[part] = {};
      ns = ns[part];
    }
    if (typeof ns[spec.name] === 'undefined') {
      ns[spec.name] = makeAsync(spec.action, spec.fields, spec.parity);
    }
    var key = spec.namespace;
    if (!registeredByNamespace[key]) registeredByNamespace[key] = [];
    registeredByNamespace[key].push(spec.name);
  }
  // Install a Proxy on each leaf namespace that throws E_UNKNOWN_API when an
  // unregistered member is *called* (not accessed). This catches
  // `web.tab.nope()` with a precise error instead of a bare TypeError.
  for (var nsPath in registeredByNamespace) {
    var target = globalThis;
    var nsParts = nsPath.split('.');
    for (var j = 0; j < nsParts.length; j++) {
      target = target[nsParts[j]];
      if (!target) break;
    }
    if (!target || typeof target !== 'object') continue;
    var registered = registeredByNamespace[nsPath];
    var sortedSiblings = registered.slice().sort();
    __installNamespaceProxy(target, nsPath, sortedSiblings);
  }
  if (typeof globalThis.fetch === 'undefined' && typeof web !== 'undefined' && typeof web.fetch === 'function') {
    globalThis.fetch = web.fetch;
  }
}

function __installNamespaceProxy(target, nsPath, siblings) {
  // Truncate sibling list to 12 names for the error message.
  var siblingHint = siblings.slice(0, 12).join(', ');
  if (siblings.length > 12) siblingHint += ', ...';
  var proxy = new Proxy(target, {
    get: function (t, prop, receiver) {
      // Symbols (e.g. Symbol.toPrimitive) and registered names: pass through.
      if (typeof prop === 'symbol') return t[prop];
      if (registeredHas(siblings, prop)) return t[prop];
      var val = t[prop];
      if (typeof val !== 'undefined') return val;
      // Unknown member: return a function that throws only when called.
      return function __unknownApi() {
        var publicName = nsPath + '.' + String(prop);
        var e = new Error(
          'Unknown API: ' + publicName + '. Available: ' + siblingHint
        );
        e.code = 'E_UNKNOWN_API';
        e.category = 'validation';
        e.publicName = publicName;
        e.action = publicName;
        e.hint = 'Call get_doc to list every registered API and its exact signature.';
        throw e;
      };
    },
  });
  // Replace the namespace object on globalThis with the proxy.
  var parent = globalThis;
  var parts = nsPath.split('.');
  for (var k = 0; k < parts.length - 1; k++) parent = parent[parts[k]];
  parent[parts[parts.length - 1]] = proxy;
}

function registeredHas(siblings, prop) {
  for (var i = 0; i < siblings.length; i++) {
    if (siblings[i] === prop) return true;
  }
  return false;
}
