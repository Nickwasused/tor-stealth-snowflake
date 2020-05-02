# tor-stealth-snowflake
Enable the Tor Snowflake without user Input.

# Setup
## Quick Way (uncompressed)
<code><script src="https://nickwasused.github.io/tor-stealth-snowflake/proxy.js"></script></code>
## Use jsdelivr.net (compressed, cdn)
<code><script src="https://cdn.jsdelivr.net/gh/nickwasused/tor-stealth-snowflake/proxy.min.js"></script></code>
## Manual Way
Add this Script to your html file

```
<script>
class Broker {

  constructor(config) {
	this.getClientOffer = this.getClientOffer.bind(this);
	this._postRequest = this._postRequest.bind(this);

	this.config = config
	this.url = config.brokerUrl;
	this.clients = 0;
	if (0 === this.url.indexOf('localhost', 0)) {
	  this.url = 'http://' + this.url;
	}
	if (0 !== this.url.indexOf('http', 0)) {
	  this.url = 'https://' + this.url;
	}
	if ('/' !== this.url.substr(-1)) {
	  this.url += '/';
	}
  }

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
  return fulfill(response.Offer);
} else if (response.Status == Broker.STATUS.TIMEOUT) {
  return reject(Broker.MESSAGE.TIMEOUT);
} else {
  return reject(Broker.MESSAGE.UNEXPECTED);
}
		  default:
return reject(Broker.MESSAGE.UNEXPECTED);
		}
	  };
	  this._xhr = xhr;
	  var data = {"Version": "1.1", "Sid": id, "Type": this.config.proxyType}
	  return this._postRequest(xhr, 'proxy', JSON.stringify(data));
	});
  }

  sendAnswer(id, answer) {
	var xhr;
	xhr = new XMLHttpRequest();
	xhr.onreadystatechange = function() {
	  if (xhr.DONE !== xhr.readyState) {
		return;
	  }
	  switch (xhr.status) {
		case Broker.CODE.OK:

		default:
		  
	  }
	};
	var data = {"Version": "1.0", "Sid": id, "Answer": JSON.stringify(answer)};
	return this._postRequest(xhr, 'answer', JSON.stringify(data));
  }

  _postRequest(xhr, urlSuffix, payload) {
	var err;
	try {
	  xhr.open('POST', this.url + urlSuffix);
	} catch (error) {
	  err = error;

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

var proxybroker = atob('c25vd2ZsYWtlLWJyb2tlci5mcmVlaGF2ZW4ubmV0');
var proxyrelay = atob('c25vd2ZsYWtlLmZyZWVoYXZlbi5uZXQ=')

Config.prototype.brokerUrl = proxybroker;

Config.prototype.relayAddr = {
  host: proxyrelay,
  port: '443'
};

Config.prototype.rateLimitBytes = void 0;

Config.prototype.minRateLimit = 10 * 1024;

Config.prototype.rateLimitHistory = 5.0;

Config.prototype.defaultBrokerPollInterval = 300.0 * 1000;

Config.prototype.maxNumClients = 1;

Config.prototype.proxyType = "";

Config.prototype.pcConfig = {
  iceServers: [
	{
	  urls: ['stun:stun.l.google.com:19302']
	}
  ]
};

class ProxyPair {

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

	  if (null === evt.candidate) {

		return snowflake.broker.sendAnswer(this.id, this.pc.localDescription);
	  }
	};

	return this.pc.ondatachannel = (dc) => {
	  var channel;
	  channel = dc.channel;
	  this.prepareDataChannel(channel);
	  return this.client = channel;
	};
  }

  receiveWebRTCOffer(offer) {
	if ('offer' !== offer.type) {
	  return false;
	}
	try {
	  this.pc.setRemoteDescription(offer);
	} catch (error) {
	  return false;
	}
	return true;
  }

  prepareDataChannel(channel) {
	channel.onopen = () => {

	  return this.connectRelay();
	};
	channel.onclose = () => {
	  this.flush();
	  return this.close();
	};
	channel.onerror = function() {
	};
	channel.binaryType = "arraybuffer";
	return channel.onmessage = this.onClientToRelayMessage;
  }

  connectRelay() {
	var params, peer_ip, ref;

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
	};
	this.relay.onclose = () => {
	  this.flush();
	  return this.close();
	};
	this.relay.onerror = this.onError;
	this.relay.onmessage = this.onRelayToClientMessage;

	return this.timer = setTimeout((() => {
	  if (0 === this.timer) {
		return;
	  }
	  return relay.onclose();
	}), 5000);
  }


  onClientToRelayMessage(msg) {
	this.c2rSchedule.push(msg.data);
	return this.flush();
  }


  onRelayToClientMessage(event) {
	this.r2cSchedule.push(event.data);
	return this.flush();
  }

  onError(event) {
	return this.close();
  }


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

	  if (this.relayIsReady() && this.relay.bufferedAmount < this.MAX_BUFFER && this.c2rSchedule.length > 0) {
		chunk = this.c2rSchedule.shift();
		this.rateLimit.update(chunk.byteLength);
		this.relay.send(chunk);
		busy = true;
	  }

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
ProxyPair.prototype.client = null;
ProxyPair.prototype.relay = null;

ProxyPair.prototype.timer = 0;
ProxyPair.prototype.flush_timeout_id = null;

ProxyPair.prototype.onCleanup = null;

class Snowflake {


  constructor(config, broker) {
	this.receiveOffer = this.receiveOffer.bind(this);

	this.config = config;
	this.broker = broker;
	this.proxyPairs = [];
	if (void 0 === this.config.rateLimitBytes) {
	  this.rateLimit = new DummyRateLimit();
	} else {
	  this.rateLimit = new BucketRateLimit(this.config.rateLimitBytes * this.config.rateLimitHistory, this.config.rateLimitHistory);
	}
	this.retries = 0;
  }

  setRelayAddr(relayAddr) {
	this.relayAddr = relayAddr;
	return true;
  }

  beginWebRTC() {
	this.pollBroker();
	return this.pollInterval = setInterval((() => {
	  return this.pollBroker();
	}), this.config.defaultBrokerPollInterval);
  }

  pollBroker() {
	var msg, pair, recv;

	pair = this.makeProxyPair();
	if (!pair) {
	  return;
	}
	
	msg = 'Polling for client ... ';
	if (this.retries > 0) {
	  msg += '[retries: ' + this.retries + ']';
	}

	recv = this.broker.getClientOffer(pair.id);
	recv.then((desc) => {
	  if (!this.receiveOffer(pair, desc)) {
		return pair.close();
	  }

	  return setTimeout((() => {
		if (!pair.webrtcIsReady()) {
		  return pair.close();
		}
	  }), 20000);
	}, function() {

	  return pair.close();
	});
	return this.retries++;
  }

  receiveOffer(pair, desc) {
	var e, offer, sdp;
	try {
	  offer = JSON.parse(desc);
	  sdp = new SessionDescription(offer);
	  if (pair.receiveWebRTCOffer(sdp)) {
		this.sendAnswer(pair);
		return true;
	  } else {
		return false;
	  }
	} catch (error) {
	  return false;
	}
  }

  sendAnswer(pair) {
	var fail, next;
	next = function(sdp) {
	  return pair.pc.setLocalDescription(sdp).catch(fail);
	};
	fail = function() {
	  pair.close();
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

	pair.onCleanup = () => {
	  var ind;

	  ind = this.proxyPairs.indexOf(pair);
	  if (ind > -1) {
		return this.proxyPairs.splice(ind, 1);
	  }
	};
	pair.begin();
	return pair;
  }


  disable() {
	var results;
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


class Util {

  static genSnowflakeID() {
	return Math.random().toString(36).substring(2);
  }

  static hasWebRTC() {
	return typeof PeerConnection === 'function';
  }

}


class Parse {

  static address(spec) {
	var host, m, port;
	m = null;
	if (!m) {
	  m = spec.match(/^\[([\0-9a-fA-F:.]+)\]:([0-9]+)$/);
	}
	if (!m) {
	  m = spec.match(/^([0-9.]+):([0-9]+)$/);
	}
	if (!m) {
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

class WS {

  static buildUrl(scheme, host, port, path, params) {
	var parts;
	parts = [];
	parts.push(encodeURIComponent(scheme));
	parts.push('://');

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

var debug, snowflake, config, broker, init, update, silenceNotifications, query;

(function() {

  snowflake = null;

  query = new URLSearchParams(location.search);

  debug = Params.getBool(query, 'debug', false);

  silenceNotifications = Params.getBool(query, 'silent', false);

  update = function() {

	if (!Util.hasWebRTC()) {
	  snowflake.disable();
	  return;
	}

	WS.probeWebsocket(config.relayAddr)
	.then(
	  () => {
		snowflake.setRelayAddr(config.relayAddr);
		snowflake.beginWebRTC();
	  },
	  () => {
		snowflake.disable();
	  }
	);
  };

  init = function() {

	config = new Config("badge");
	if ('off' !== query.get('ratelimit')) {
	  config.rateLimitBytes = Params.getByteCount(query, 'ratelimit', config.rateLimitBytes);
	}
	broker = new Broker(config);
	snowflake = new Snowflake(config, broker);
	
	update();
  };

  window.onbeforeunload = function() {
	if (
	  !silenceNotifications &&
	  snowflake !== null
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
	  init();
  }

}());
</script>
```
