const availableLangs = new Set([
  'bn_BD',
  'ca',
  'de',
  'en',
  'en_GB',
  'en_US',
  'es_ES',
  'fr',
  'he',
  'it',
  'lt',
  'mk',
  'pt_BR',
  'pt_PT',
  'ru',
  'sv_SE',
  'tr',
  'zh_CN',
]);

/* global log, dbg, snowflake */

/*
Communication with the snowflake broker.

Browser snowflakes must register with the broker in order
to get assigned to clients.
*/

// Represents a broker running remotely.
class Broker {

  // When interacting with the Broker, snowflake must generate a unique session
  // ID so the Broker can keep track of each proxy's signalling channels.
  // On construction, this Broker object does not do anything until
  // |getClientOffer| is called.
  constructor(config) {
    this.getClientOffer = this.getClientOffer.bind(this);
    this._postRequest = this._postRequest.bind(this);

    this.config = config
    this.url = config.brokerUrl;
    this.clients = 0;
    if (0 === this.url.indexOf('localhost', 0)) {
      // Ensure url has the right protocol + trailing slash.
      this.url = 'http://' + this.url;
    }
    if (0 !== this.url.indexOf('http', 0)) {
      this.url = 'https://' + this.url;
    }
    if ('/' !== this.url.substr(-1)) {
      this.url += '/';
    }
  }

  // Promises some client SDP Offer.
  // Registers this Snowflake with the broker using an HTTP POST request, and
  // waits for a response containing some client offer that the Broker chooses
  // for this proxy..
  // TODO: Actually support multiple clients.
  getClientOffer(id) {
    return new Promise((fulfill, reject) => {
      var xhr;
      xhr = new XMLHttpRequest();
      xhr.onreadystatechange = function() {
        if (xhr.DONE !== xhr.readyState) {
          return;
        }
        switch (xhr.status) {
          case Broker.CODE.OK:
            var response = JSON.parse(xhr.responseText);
            if (response.Status == Broker.STATUS.MATCH) {
              return fulfill(response.Offer); // Should contain offer.
            } else if (response.Status == Broker.STATUS.TIMEOUT) {
              return reject(Broker.MESSAGE.TIMEOUT);
            } else {
              log('Broker ERROR: Unexpected ' + response.Status);
              return reject(Broker.MESSAGE.UNEXPECTED);
            }
          default:
            log('Broker ERROR: Unexpected ' + xhr.status + ' - ' + xhr.statusText);
            snowflake.ui.setStatus(' failure. Please refresh.');
            return reject(Broker.MESSAGE.UNEXPECTED);
        }
      };
      this._xhr = xhr; // Used by spec to fake async Broker interaction
      var data = {"Version": "1.1", "Sid": id, "Type": this.config.proxyType}
      return this._postRequest(xhr, 'proxy', JSON.stringify(data));
    });
  }

  // Assumes getClientOffer happened, and a WebRTC SDP answer has been generated.
  // Sends it back to the broker, which passes it to back to the original client.
  sendAnswer(id, answer) {
    var xhr;
    dbg(id + ' - Sending answer back to broker...\n');
    dbg(answer.sdp);
    xhr = new XMLHttpRequest();
    xhr.onreadystatechange = function() {
      if (xhr.DONE !== xhr.readyState) {
        return;
      }
      switch (xhr.status) {
        case Broker.CODE.OK:
          dbg('Broker: Successfully replied with answer.');
          return dbg(xhr.responseText);
        default:
          dbg('Broker ERROR: Unexpected ' + xhr.status + ' - ' + xhr.statusText);
          return snowflake.ui.setStatus(' failure. Please refresh.');
      }
    };
    var data = {"Version": "1.0", "Sid": id, "Answer": JSON.stringify(answer)};
    return this._postRequest(xhr, 'answer', JSON.stringify(data));
  }

  // urlSuffix for the broker is different depending on what action
  // is desired.
  _postRequest(xhr, urlSuffix, payload) {
    var err;
    try {
      xhr.open('POST', this.url + urlSuffix);
    } catch (error) {
      err = error;
      /*
      An exception happens here when, for example, NoScript allows the domain
      on which the proxy badge runs, but not the domain to which it's trying
      to make the HTTP xhr. The exception message is like "Component
      returned failure code: 0x805e0006 [nsIXMLHttpRequest.open]" on Firefox.
      */
      log('Broker: exception while connecting: ' + err.message);
      return;
    }
    return xhr.send(payload);
  }

}

Broker.CODE = {
  OK: 200,
  BAD_REQUEST: 400,
  INTERNAL_SERVER_ERROR: 500
};

Broker.STATUS = {
  MATCH: "client match",
  TIMEOUT: "no match"
};

Broker.MESSAGE = {
  TIMEOUT: 'Timed out waiting for a client offer.',
  UNEXPECTED: 'Unexpected status.'
};

Broker.prototype.clients = 0;

class Config {
  constructor(proxyType) {
    this.proxyType = proxyType || '';
  }
}

Config.prototype.brokerUrl = 'snowflake-broker.freehaven.net';

Config.prototype.relayAddr = {
  host: 'snowflake.freehaven.net',
  port: '443'
};

// Original non-wss relay:
// host: '192.81.135.242'
// port: 9902
Config.prototype.cookieName = "snowflake-allow";

// Bytes per second. Set to undefined to disable limit.
Config.prototype.rateLimitBytes = void 0;

Config.prototype.minRateLimit = 10 * 1024;

Config.prototype.rateLimitHistory = 5.0;

Config.prototype.defaultBrokerPollInterval = 300.0 * 1000;

Config.prototype.maxNumClients = 1;

Config.prototype.proxyType = "";

// TODO: Different ICE servers.
Config.prototype.pcConfig = {
  iceServers: [
    {
      urls: ['stun:stun.l.google.com:19302']
    }
  ]
};
/* global snowflake, log, dbg, Util, PeerConnection, Parse, WS */

/*
Represents a single:

   client <-- webrtc --> snowflake <-- websocket --> relay

Every ProxyPair has a Snowflake ID, which is necessary when responding to the
Broker with an WebRTC answer.
*/

class ProxyPair {

  /*
  Constructs a ProxyPair where:
  - @relayAddr is the destination relay
  - @rateLimit specifies a rate limit on traffic
  */
  constructor(relayAddr, rateLimit, pcConfig) {
    this.prepareDataChannel = this.prepareDataChannel.bind(this);
    this.connectRelay = this.connectRelay.bind(this);
    this.onClientToRelayMessage = this.onClientToRelayMessage.bind(this);
    this.onRelayToClientMessage = this.onRelayToClientMessage.bind(this);
    this.onError = this.onError.bind(this);
    this.flush = this.flush.bind(this);

    this.relayAddr = relayAddr;
    this.rateLimit = rateLimit;
    this.pcConfig = pcConfig;
    this.id = Util.genSnowflakeID();
    this.c2rSchedule = [];
    this.r2cSchedule = [];
  }

  // Prepare a WebRTC PeerConnection and await for an SDP offer.
  begin() {
    this.pc = new PeerConnection(this.pcConfig, {
      optional: [
        {
          DtlsSrtpKeyAgreement: true
        },
        {
          RtpDataChannels: false
        }
      ]
    });
    this.pc.onicecandidate = (evt) => {
      // Browser sends a null candidate once the ICE gathering completes.
      if (null === evt.candidate) {
        // TODO: Use a promise.all to tell Snowflake about all offers at once,
        // once multiple proxypairs are supported.
        dbg('Finished gathering ICE candidates.');
        return snowflake.broker.sendAnswer(this.id, this.pc.localDescription);
      }
    };
    // OnDataChannel triggered remotely from the client when connection succeeds.
    return this.pc.ondatachannel = (dc) => {
      var channel;
      channel = dc.channel;
      dbg('Data Channel established...');
      this.prepareDataChannel(channel);
      return this.client = channel;
    };
  }

  receiveWebRTCOffer(offer) {
    if ('offer' !== offer.type) {
      log('Invalid SDP received -- was not an offer.');
      return false;
    }
    try {
      this.pc.setRemoteDescription(offer);
    } catch (error) {
      log('Invalid SDP message.');
      return false;
    }
    dbg('SDP ' + offer.type + ' successfully received.');
    return true;
  }

  // Given a WebRTC DataChannel, prepare callbacks.
  prepareDataChannel(channel) {
    channel.onopen = () => {
      log('WebRTC DataChannel opened!');
      snowflake.ui.setActive(true);
      // This is the point when the WebRTC datachannel is done, so the next step
      // is to establish websocket to the server.
      return this.connectRelay();
    };
    channel.onclose = () => {
      log('WebRTC DataChannel closed.');
      snowflake.ui.setStatus('disconnected by webrtc.');
      snowflake.ui.setActive(false);
      this.flush();
      return this.close();
    };
    channel.onerror = function() {
      return log('Data channel error!');
    };
    channel.binaryType = "arraybuffer";
    return channel.onmessage = this.onClientToRelayMessage;
  }

  // Assumes WebRTC datachannel is connected.
  connectRelay() {
    var params, peer_ip, ref;
    dbg('Connecting to relay...');
    // Get a remote IP address from the PeerConnection, if possible. Add it to
    // the WebSocket URL's query string if available.
    // MDN marks remoteDescription as "experimental". However the other two
    // options, currentRemoteDescription and pendingRemoteDescription, which
    // are not marked experimental, were undefined when I tried them in Firefox
    // 52.2.0.
    // https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/remoteDescription
    peer_ip = Parse.ipFromSDP((ref = this.pc.remoteDescription) != null ? ref.sdp : void 0);
    params = [];
    if (peer_ip != null) {
      params.push(["client_ip", peer_ip]);
    }
    var relay = this.relay = WS.makeWebsocket(this.relayAddr, params);
    this.relay.label = 'websocket-relay';
    this.relay.onopen = () => {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = 0;
      }
      log(relay.label + ' connected!');
      return snowflake.ui.setStatus('connected');
    };
    this.relay.onclose = () => {
      log(relay.label + ' closed.');
      snowflake.ui.setStatus('disconnected.');
      snowflake.ui.setActive(false);
      this.flush();
      return this.close();
    };
    this.relay.onerror = this.onError;
    this.relay.onmessage = this.onRelayToClientMessage;
    // TODO: Better websocket timeout handling.
    return this.timer = setTimeout((() => {
      if (0 === this.timer) {
        return;
      }
      log(relay.label + ' timed out connecting.');
      return relay.onclose();
    }), 5000);
  }

  // WebRTC --> websocket
  onClientToRelayMessage(msg) {
    dbg('WebRTC --> websocket data: ' + msg.data.byteLength + ' bytes');
    this.c2rSchedule.push(msg.data);
    return this.flush();
  }

  // websocket --> WebRTC
  onRelayToClientMessage(event) {
    dbg('websocket --> WebRTC data: ' + event.data.byteLength + ' bytes');
    this.r2cSchedule.push(event.data);
    return this.flush();
  }

  onError(event) {
    var ws;
    ws = event.target;
    log(ws.label + ' error.');
    return this.close();
  }

  // Close both WebRTC and websocket.
  close() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = 0;
    }
    if (this.webrtcIsReady()) {
      this.client.close();
    }
    if (this.peerConnOpen()) {
      this.pc.close();
    }
    if (this.relayIsReady()) {
      this.relay.close();
    }
    this.onCleanup();
  }

  // Send as much data in both directions as the rate limit currently allows.
  flush() {
    var busy, checkChunks;
    if (this.flush_timeout_id) {
      clearTimeout(this.flush_timeout_id);
    }
    this.flush_timeout_id = null;
    busy = true;
    checkChunks = () => {
      var chunk;
      busy = false;
      // WebRTC --> websocket
      if (this.relayIsReady() && this.relay.bufferedAmount < this.MAX_BUFFER && this.c2rSchedule.length > 0) {
        chunk = this.c2rSchedule.shift();
        this.rateLimit.update(chunk.byteLength);
        this.relay.send(chunk);
        busy = true;
      }
      // websocket --> WebRTC
      if (this.webrtcIsReady() && this.client.bufferedAmount < this.MAX_BUFFER && this.r2cSchedule.length > 0) {
        chunk = this.r2cSchedule.shift();
        this.rateLimit.update(chunk.byteLength);
        this.client.send(chunk);
        return busy = true;
      }
    };
    while (busy && !this.rateLimit.isLimited()) {
      checkChunks();
    }
    if (this.r2cSchedule.length > 0 || this.c2rSchedule.length > 0 || (this.relayIsReady() && this.relay.bufferedAmount > 0) || (this.webrtcIsReady() && this.client.bufferedAmount > 0)) {
      return this.flush_timeout_id = setTimeout(this.flush, this.rateLimit.when() * 1000);
    }
  }

  webrtcIsReady() {
    return null !== this.client && 'open' === this.client.readyState;
  }

  relayIsReady() {
    return (null !== this.relay) && (WebSocket.OPEN === this.relay.readyState);
  }

  isClosed(ws) {
    return void 0 === ws || WebSocket.CLOSED === ws.readyState;
  }

  peerConnOpen() {
    return (null !== this.pc) && ('closed' !== this.pc.connectionState);
  }

}

ProxyPair.prototype.MAX_BUFFER = 10 * 1024 * 1024;

ProxyPair.prototype.pc = null;
ProxyPair.prototype.client = null; // WebRTC Data channel
ProxyPair.prototype.relay = null; // websocket

ProxyPair.prototype.timer = 0;
ProxyPair.prototype.flush_timeout_id = null;

ProxyPair.prototype.onCleanup = null;
/* global log, dbg, DummyRateLimit, BucketRateLimit, SessionDescription, ProxyPair */

/*
A JavaScript WebRTC snowflake proxy

Uses WebRTC from the client, and Websocket to the server.

Assume that the webrtc client plugin is always the offerer, in which case
this proxy must always act as the answerer.

TODO: More documentation
*/

// Minimum viable snowflake for now - just 1 client.
class Snowflake {

  // Prepare the Snowflake with a Broker (to find clients) and optional UI.
  constructor(config, ui, broker) {
    this.receiveOffer = this.receiveOffer.bind(this);

    this.config = config;
    this.ui = ui;
    this.broker = broker;
    this.proxyPairs = [];
    if (void 0 === this.config.rateLimitBytes) {
      this.rateLimit = new DummyRateLimit();
    } else {
      this.rateLimit = new BucketRateLimit(this.config.rateLimitBytes * this.config.rateLimitHistory, this.config.rateLimitHistory);
    }
    this.retries = 0;
  }

  // Set the target relay address spec, which is expected to be websocket.
  // TODO: Should potentially fetch the target from broker later, or modify
  // entirely for the Tor-independent version.
  setRelayAddr(relayAddr) {
    this.relayAddr = relayAddr;
    log('Using ' + relayAddr.host + ':' + relayAddr.port + ' as Relay.');
    return true;
  }

  // Initialize WebRTC PeerConnection, which requires beginning the signalling
  // process. |pollBroker| automatically arranges signalling.
  beginWebRTC() {
    this.pollBroker();
    return this.pollInterval = setInterval((() => {
      return this.pollBroker();
    }), this.config.defaultBrokerPollInterval);
  }

  // Regularly poll Broker for clients to serve until this snowflake is
  // serving at capacity, at which point stop polling.
  pollBroker() {
    var msg, pair, recv;
    // Poll broker for clients.
    pair = this.makeProxyPair();
    if (!pair) {
      log('At client capacity.');
      return;
    }
    log('Polling broker..');
    // Do nothing until a new proxyPair is available.
    msg = 'Polling for client ... ';
    if (this.retries > 0) {
      msg += '[retries: ' + this.retries + ']';
    }
    this.ui.setStatus(msg);
    recv = this.broker.getClientOffer(pair.id);
    recv.then((desc) => {
      if (!this.receiveOffer(pair, desc)) {
        return pair.close();
      }
      //set a timeout for channel creation
      return setTimeout((() => {
        if (!pair.webrtcIsReady()) {
          log('proxypair datachannel timed out waiting for open');
          return pair.close();
        }
      }), 20000); // 20 second timeout
    }, function() {
      //on error, close proxy pair
      return pair.close();
    });
    return this.retries++;
  }

  // Receive an SDP offer from some client assigned by the Broker,
  // |pair| - an available ProxyPair.
  receiveOffer(pair, desc) {
    var e, offer, sdp;
    try {
      offer = JSON.parse(desc);
      dbg('Received:\n\n' + offer.sdp + '\n');
      sdp = new SessionDescription(offer);
      if (pair.receiveWebRTCOffer(sdp)) {
        this.sendAnswer(pair);
        return true;
      } else {
        return false;
      }
    } catch (error) {
      e = error;
      log('ERROR: Unable to receive Offer: ' + e);
      return false;
    }
  }

  sendAnswer(pair) {
    var fail, next;
    next = function(sdp) {
      dbg('webrtc: Answer ready.');
      return pair.pc.setLocalDescription(sdp).catch(fail);
    };
    fail = function() {
      pair.close();
      return dbg('webrtc: Failed to create or set Answer');
    };
    return pair.pc.createAnswer().then(next).catch(fail);
  }

  makeProxyPair() {
    if (this.proxyPairs.length >= this.config.maxNumClients) {
      return null;
    }
    var pair;
    pair = new ProxyPair(this.relayAddr, this.rateLimit, this.config.pcConfig);
    this.proxyPairs.push(pair);

    log('Snowflake IDs: ' + (this.proxyPairs.map(function(p) {
      return p.id;
    })).join(' | '));

    pair.onCleanup = () => {
      var ind;
      // Delete from the list of proxy pairs.
      ind = this.proxyPairs.indexOf(pair);
      if (ind > -1) {
        return this.proxyPairs.splice(ind, 1);
      }
    };
    pair.begin();
    return pair;
  }

  // Stop all proxypairs.
  disable() {
    var results;
    log('Disabling Snowflake.');
    clearInterval(this.pollInterval);
    results = [];
    while (this.proxyPairs.length > 0) {
      results.push(this.proxyPairs.pop().close());
    }
    return results;
  }

}

Snowflake.prototype.relayAddr = null;
Snowflake.prototype.rateLimit = null;
Snowflake.prototype.pollInterval = null;

Snowflake.MESSAGE = {
  CONFIRMATION: 'You\'re currently serving a Tor user via Snowflake.'
};
/*
All of Snowflake's DOM manipulation and inputs.
*/

class UI {

  setStatus() {}

  setActive(connected) {
    return this.active = connected;
  }

  log() {}

}

UI.prototype.active = false;
/* exported Util, Params, DummyRateLimit */

/*
A JavaScript WebRTC snowflake proxy

Contains helpers for parsing query strings and other utilities.
*/

class Util {

  static genSnowflakeID() {
    return Math.random().toString(36).substring(2);
  }

  static hasWebRTC() {
    return typeof PeerConnection === 'function';
  }

  static hasCookies() {
    return navigator.cookieEnabled;
  }

}


class Parse {

  // Parse a cookie data string (usually document.cookie). The return type is an
  // object mapping cookies names to values. Returns null on error.
  // http://www.w3.org/TR/DOM-Level-2-HTML/html.html#ID-8747038
  static cookie(cookies) {
    var i, j, len, name, result, string, strings, value;
    result = {};
    strings = [];
    if (cookies) {
      strings = cookies.split(';');
    }
    for (i = 0, len = strings.length; i < len; i++) {
      string = strings[i];
      j = string.indexOf('=');
      if (-1 === j) {
        return null;
      }
      name = decodeURIComponent(string.substr(0, j).trim());
      value = decodeURIComponent(string.substr(j + 1).trim());
      if (!(name in result)) {
        result[name] = value;
      }
    }
    return result;
  }

  // Parse an address in the form 'host:port'. Returns an Object with keys 'host'
  // (String) and 'port' (int). Returns null on error.
  static address(spec) {
    var host, m, port;
    m = null;
    if (!m) {
      // IPv6 syntax.
      m = spec.match(/^\[([\0-9a-fA-F:.]+)\]:([0-9]+)$/);
    }
    if (!m) {
      // IPv4 syntax.
      m = spec.match(/^([0-9.]+):([0-9]+)$/);
    }
    if (!m) {
      // TODO: Domain match
      return null;
    }
    host = m[1];
    port = parseInt(m[2], 10);
    if (isNaN(port) || port < 0 || port > 65535) {
      return null;
    }
    return {
      host: host,
      port: port
    };
  }

  // Parse a count of bytes. A suffix of 'k', 'm', or 'g' (or uppercase)
  // does what you would think. Returns null on error.
  static byteCount(spec) {
    let matches = spec.match(/^(\d+(?:\.\d*)?)(\w*)$/);
    if (matches === null) {
      return null;
    }
    let count = Number(matches[1]);
    if (isNaN(count)) {
      return null;
    }
    const UNITS = new Map([
      ['', 1],
      ['k', 1024],
      ['m', 1024*1024],
      ['g', 1024*1024*1024],
    ]);
    let unit = matches[2].toLowerCase();
    if (!UNITS.has(unit)) {
      return null;
    }
    let multiplier = UNITS.get(unit);
    return count * multiplier;
  }

  // Parse a connection-address out of the "c=" Connection Data field of a
  // session description. Return undefined if none is found.
  // https://tools.ietf.org/html/rfc4566#section-5.7
  static ipFromSDP(sdp) {
    var i, len, m, pattern, ref;
    ref = [/^c=IN IP4 ([\d.]+)(?:(?:\/\d+)?\/\d+)?(:? |$)/m, /^c=IN IP6 ([0-9A-Fa-f:.]+)(?:\/\d+)?(:? |$)/m];
    for (i = 0, len = ref.length; i < len; i++) {
      pattern = ref[i];
      m = pattern.exec(sdp);
      if (m != null) {
        return m[1];
      }
    }
  }

}


class Params {

  static getBool(query, param, defaultValue) {
    if (!query.has(param)) {
      return defaultValue;
    }
    var val;
    val = query.get(param);
    if ('true' === val || '1' === val || '' === val) {
      return true;
    }
    if ('false' === val || '0' === val) {
      return false;
    }
    return null;
  }

  // Get an object value and parse it as a byte count. Example byte counts are
  // '100' and '1.3m'. Returns |defaultValue| if param is not a key. Return null
  // on a parsing error.
  static getByteCount(query, param, defaultValue) {
    if (!query.has(param)) {
      return defaultValue;
    }
    return Parse.byteCount(query.get(param));
  }

}


class BucketRateLimit {

  constructor(capacity, time) {
    this.capacity = capacity;
    this.time = time;
  }

  age() {
    var delta, now;
    now = new Date();
    delta = (now - this.lastUpdate) / 1000.0;
    this.lastUpdate = now;
    this.amount -= delta * this.capacity / this.time;
    if (this.amount < 0.0) {
      return this.amount = 0.0;
    }
  }

  update(n) {
    this.age();
    this.amount += n;
    return this.amount <= this.capacity;
  }

  // How many seconds in the future will the limit expire?
  when() {
    this.age();
    return (this.amount - this.capacity) / (this.capacity / this.time);
  }

  isLimited() {
    this.age();
    return this.amount > this.capacity;
  }

}

BucketRateLimit.prototype.amount = 0.0;

BucketRateLimit.prototype.lastUpdate = new Date();


// A rate limiter that never limits.
class DummyRateLimit {

  constructor(capacity, time) {
    this.capacity = capacity;
    this.time = time;
  }

  update() {
    return true;
  }

  when() {
    return 0.0;
  }

  isLimited() {
    return false;
  }

}
/*
Only websocket-specific stuff.
*/

class WS {

  // Build an escaped URL string from unescaped components. Only scheme and host
  // are required. See RFC 3986, section 3.
  static buildUrl(scheme, host, port, path, params) {
    var parts;
    parts = [];
    parts.push(encodeURIComponent(scheme));
    parts.push('://');
    // If it contains a colon but no square brackets, treat it as IPv6.
    if (host.match(/:/) && !host.match(/[[\]]/)) {
      parts.push('[');
      parts.push(host);
      parts.push(']');
    } else {
      parts.push(encodeURIComponent(host));
    }
    if (void 0 !== port && this.DEFAULT_PORTS[scheme] !== port) {
      parts.push(':');
      parts.push(encodeURIComponent(port.toString()));
    }
    if (void 0 !== path && '' !== path) {
      if (!path.match(/^\//)) {
        path = '/' + path;
      }
      path = path.replace(/[^/]+/, function(m) {
        return encodeURIComponent(m);
      });
      parts.push(path);
    }
    if (void 0 !== params) {
      parts.push('?');
      parts.push(new URLSearchParams(params).toString());
    }
    return parts.join('');
  }

  static makeWebsocket(addr, params) {
    var url, ws, wsProtocol;
    wsProtocol = this.WSS_ENABLED ? 'wss' : 'ws';
    url = this.buildUrl(wsProtocol, addr.host, addr.port, '/', params);
    ws = new WebSocket(url);
    /*
    'User agents can use this as a hint for how to handle incoming binary data:
    if the attribute is set to 'blob', it is safe to spool it to disk, and if it
    is set to 'arraybuffer', it is likely more efficient to keep the data in
    memory.'
    */
    ws.binaryType = 'arraybuffer';
    return ws;
  }

  static probeWebsocket(addr) {
    return new Promise((resolve, reject) => {
      const ws = WS.makeWebsocket(addr);
      ws.onopen = () => {
        resolve();
        ws.close();
      };
      ws.onerror = () => {
        reject();
        ws.close();
      };
    });
  }

}

WS.WSS_ENABLED = true;

WS.DEFAULT_PORTS = {
  http: 80,
  https: 443
};
/* global module, require */

/*
WebRTC shims for multiple browsers.
*/

if (typeof module !== "undefined" && module !== null ? module.exports : void 0) {
  window = {};
  document = {
    getElementById: function() {
      return null;
    }
  };
  chrome = {};
  location = { search: '' };
  ({ URLSearchParams } = require('url'));
  if ((typeof TESTING === "undefined" || TESTING === null) || !TESTING) {
    webrtc = require('wrtc');
    PeerConnection = webrtc.RTCPeerConnection;
    IceCandidate = webrtc.RTCIceCandidate;
    SessionDescription = webrtc.RTCSessionDescription;
    WebSocket = require('ws');
    ({ XMLHttpRequest } = require('xmlhttprequest'));
  }
} else {
  PeerConnection = window.RTCPeerConnection || window.mozRTCPeerConnection || window.webkitRTCPeerConnection;
  IceCandidate = window.RTCIceCandidate || window.mozRTCIceCandidate;
  SessionDescription = window.RTCSessionDescription || window.mozRTCSessionDescription;
  WebSocket = window.WebSocket;
  XMLHttpRequest = window.XMLHttpRequest;
}
/* global Util, Params, Config, UI, Broker, Snowflake, Popup, Parse, availableLangs, WS */

/*
UI
*/

class Messages {
  constructor(json) {
    this.json = json;
  }
  getMessage(m, ...rest) {
    let message = this.json[m].message;
    return message.replace(/\$(\d+)/g, (...args) => {
      return rest[Number(args[1]) - 1];
    });
  }
}

let messages = null;

class BadgeUI extends UI {

  constructor() {
    super();
    this.popup = new Popup();
  }

  setStatus() {}

  missingFeature(missing) {
    this.popup.setEnabled(false);
    this.popup.setActive(false);
    this.popup.setStatusText(messages.getMessage('popupStatusOff'));
    this.popup.setStatusDesc(missing, true);
    this.popup.hideButton();
  }

  turnOn() {
    const clients = this.active ? 1 : 0;
    this.popup.setChecked(true);
    if (clients > 0) {
      this.popup.setStatusText(messages.getMessage('popupStatusOn', String(clients)));
    } else {
      this.popup.setStatusText(messages.getMessage('popupStatusReady'));
    }
    // FIXME: Share stats from webext
    this.popup.setStatusDesc('');
    this.popup.setEnabled(true);
    this.popup.setActive(this.active);
  }

  turnOff() {
    this.popup.setChecked(false);
    this.popup.setStatusText(messages.getMessage('popupStatusOff'));
    this.popup.setStatusDesc('');
    this.popup.setEnabled(false);
    this.popup.setActive(false);
  }

  setActive(connected) {
    super.setActive(connected);
    this.turnOn();
  }


}

BadgeUI.prototype.popup = null;


/*
Entry point.
*/

// Defaults to opt-in.
var COOKIE_NAME = "snowflake-allow";
var COOKIE_LIFETIME = "Thu, 01 Jan 2038 00:00:00 GMT";
var COOKIE_EXPIRE = "Thu, 01 Jan 1970 00:00:01 GMT";

function setSnowflakeCookie(val, expires) {
  document.cookie = `${COOKIE_NAME}=${val}; path=/; expires=${expires};`;
}

const defaultLang = 'en_US';

// Resolve as in,
// https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Internationalization#Localized_string_selection
function getLang() {
  let lang = navigator.language || defaultLang;
  lang = lang.replace(/-/g, '_');
  if (availableLangs.has(lang)) {
    return lang;
  }
  lang = lang.split('_')[0];
  if (availableLangs.has(lang)) {
    return lang;
  }
  return defaultLang;
}

var debug, snowflake, config, broker, ui, log, dbg, init, update, silenceNotifications, query;

(function() {

  snowflake = null;

  query = new URLSearchParams(location.search);

  debug = Params.getBool(query, 'debug', false);

  silenceNotifications = Params.getBool(query, 'silent', false);

  // Log to both console and UI if applicable.
  // Requires that the snowflake and UI objects are hooked up in order to
  // log to console.
  log = function(msg) {
    console.log('Snowflake: ' + msg);
    return snowflake != null ? snowflake.ui.log(msg) : void 0;
  };

  dbg = function(msg) {
    if (debug) { log(msg); }
  };

  update = function() {
    const cookies = Parse.cookie(document.cookie);
    if (cookies[COOKIE_NAME] !== '1') {
      ui.turnOff();
      snowflake.disable();
      log('Currently not active.');
      return;
    }

    if (!Util.hasWebRTC()) {
      ui.missingFeature(messages.getMessage('popupWebRTCOff'));
      snowflake.disable();
      return;
    }

    WS.probeWebsocket(config.relayAddr)
    .then(
      () => {
        ui.turnOn();
        dbg('Contacting Broker at ' + broker.url);
        log('Starting snowflake');
        snowflake.setRelayAddr(config.relayAddr);
        snowflake.beginWebRTC();
      },
      () => {
        ui.missingFeature(messages.getMessage('popupBridgeUnreachable'));
        snowflake.disable();
        log('Could not connect to bridge.');
      }
    );
  };

  init = function() {
    ui = new BadgeUI();

    if (!Util.hasCookies()) {
      ui.missingFeature(messages.getMessage('badgeCookiesOff'));
      return;
    }

    config = new Config("badge");
    if ('off' !== query.get('ratelimit')) {
      config.rateLimitBytes = Params.getByteCount(query, 'ratelimit', config.rateLimitBytes);
    }
    broker = new Broker(config);
    snowflake = new Snowflake(config, ui, broker);
    log('== snowflake proxy ==');
    update();

    document.getElementById('enabled').addEventListener('change', (event) => {
      if (event.target.checked) {
        setSnowflakeCookie('1', COOKIE_LIFETIME);
      } else {
        setSnowflakeCookie('', COOKIE_EXPIRE);
      }
      update();
    })
  };

  // Notification of closing tab with active proxy.
  window.onbeforeunload = function() {
    if (
      !silenceNotifications &&
      snowflake !== null &&
      ui.active
    ) {
      return Snowflake.MESSAGE.CONFIRMATION;
    }
    return null;
  };

  window.onunload = function() {
    if (snowflake !== null) { snowflake.disable(); }
    return null;
  };

  window.onload = function() {
    fetch(`tor/locales/${getLang()}/messages.json`)
    .then((res) => {
      if (!res.ok) { return; }
      return res.json();
    })
    .then((json) => {
      messages = new Messages(json);
      Popup.fill(document.body, (m) => {
        return messages.getMessage(m);
      });
      init();
    });
  }

}());
