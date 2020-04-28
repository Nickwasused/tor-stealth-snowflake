class Broker{constructor(a){this.getClientOffer=this.getClientOffer.bind(this),this._postRequest=this._postRequest.bind(this),this.config=a,this.url=a.brokerUrl,this.clients=0,0===this.url.indexOf("localhost",0)&&(this.url="http://"+this.url),0!==this.url.indexOf("http",0)&&(this.url="https://"+this.url),"/"!==this.url.substr(-1)&&(this.url+="/")}getClientOffer(a){return new Promise((b,c)=>{var d;d=new XMLHttpRequest,d.onreadystatechange=function(){if(d.DONE===d.readyState)switch(d.status){case Broker.CODE.OK:var a=JSON.parse(d.responseText);return a.Status==Broker.STATUS.MATCH?b(a.Offer):a.Status==Broker.STATUS.TIMEOUT?c(Broker.MESSAGE.TIMEOUT):c(Broker.MESSAGE.UNEXPECTED);default:return c(Broker.MESSAGE.UNEXPECTED);}},this._xhr=d;var e={Version:"1.1",Sid:a,Type:this.config.proxyType};return this._postRequest(d,"proxy",JSON.stringify(e))})}sendAnswer(a,b){var c;c=new XMLHttpRequest,c.onreadystatechange=function(){if(c.DONE===c.readyState)switch(c.status){case Broker.CODE.OK:default:}};var d={Version:"1.0",Sid:a,Answer:JSON.stringify(b)};return this._postRequest(c,"answer",JSON.stringify(d))}_postRequest(a,b,c){var d;try{a.open("POST",this.url+b)}catch(a){return void(d=a)}return a.send(c)}}Broker.CODE={OK:200,BAD_REQUEST:400,INTERNAL_SERVER_ERROR:500},Broker.STATUS={MATCH:"client match",TIMEOUT:"no match"},Broker.MESSAGE={TIMEOUT:"Timed out waiting for a client offer.",UNEXPECTED:"Unexpected status."},Broker.prototype.clients=0;class Config{constructor(a){this.proxyType=a||""}}Config.prototype.brokerUrl="snowflake-broker.freehaven.net",Config.prototype.relayAddr={host:"snowflake.freehaven.net",port:"443"},Config.prototype.cookieName="snowflake-allow",Config.prototype.rateLimitBytes=void 0,Config.prototype.minRateLimit=10240,Config.prototype.rateLimitHistory=5,Config.prototype.defaultBrokerPollInterval=300000,Config.prototype.maxNumClients=1,Config.prototype.proxyType="",Config.prototype.pcConfig={iceServers:[{urls:["stun:stun.l.google.com:19302"]}]};class ProxyPair{constructor(a,b,c){this.prepareDataChannel=this.prepareDataChannel.bind(this),this.connectRelay=this.connectRelay.bind(this),this.onClientToRelayMessage=this.onClientToRelayMessage.bind(this),this.onRelayToClientMessage=this.onRelayToClientMessage.bind(this),this.onError=this.onError.bind(this),this.flush=this.flush.bind(this),this.relayAddr=a,this.rateLimit=b,this.pcConfig=c,this.id=Util.genSnowflakeID(),this.c2rSchedule=[],this.r2cSchedule=[]}begin(){return this.pc=new PeerConnection(this.pcConfig,{optional:[{DtlsSrtpKeyAgreement:!0},{RtpDataChannels:!1}]}),this.pc.onicecandidate=a=>{if(null===a.candidate)return snowflake.broker.sendAnswer(this.id,this.pc.localDescription)},this.pc.ondatachannel=a=>{var b;return b=a.channel,this.prepareDataChannel(b),this.client=b}}receiveWebRTCOffer(a){if("offer"!==a.type)return!1;try{this.pc.setRemoteDescription(a)}catch(a){return!1}return!0}prepareDataChannel(a){return a.onopen=()=>this.connectRelay(),a.onclose=()=>(this.flush(),this.close()),a.onerror=function(){},a.binaryType="arraybuffer",a.onmessage=this.onClientToRelayMessage}connectRelay(){var a,b,c;b=Parse.ipFromSDP(null==(c=this.pc.remoteDescription)?void 0:c.sdp),a=[],null!=b&&a.push(["client_ip",b]);var d=this.relay=WS.makeWebsocket(this.relayAddr,a);return this.relay.label="websocket-relay",this.relay.onopen=()=>{this.timer&&(clearTimeout(this.timer),this.timer=0)},this.relay.onclose=()=>(this.flush(),this.close()),this.relay.onerror=this.onError,this.relay.onmessage=this.onRelayToClientMessage,this.timer=setTimeout(()=>0===this.timer?void 0:d.onclose(),5e3)}onClientToRelayMessage(a){return this.c2rSchedule.push(a.data),this.flush()}onRelayToClientMessage(a){return this.r2cSchedule.push(a.data),this.flush()}onError(a){return this.close()}close(){this.timer&&(clearTimeout(this.timer),this.timer=0),this.webrtcIsReady()&&this.client.close(),this.peerConnOpen()&&this.pc.close(),this.relayIsReady()&&this.relay.close(),this.onCleanup()}flush(){var a,b;for(this.flush_timeout_id&&clearTimeout(this.flush_timeout_id),this.flush_timeout_id=null,a=!0,b=()=>{var b;if(a=!1,this.relayIsReady()&&this.relay.bufferedAmount<this.MAX_BUFFER&&0<this.c2rSchedule.length&&(b=this.c2rSchedule.shift(),this.rateLimit.update(b.byteLength),this.relay.send(b),a=!0),this.webrtcIsReady()&&this.client.bufferedAmount<this.MAX_BUFFER&&0<this.r2cSchedule.length)return b=this.r2cSchedule.shift(),this.rateLimit.update(b.byteLength),this.client.send(b),a=!0};a&&!this.rateLimit.isLimited();)b();if(0<this.r2cSchedule.length||0<this.c2rSchedule.length||this.relayIsReady()&&0<this.relay.bufferedAmount||this.webrtcIsReady()&&0<this.client.bufferedAmount)return this.flush_timeout_id=setTimeout(this.flush,1e3*this.rateLimit.when())}webrtcIsReady(){return null!==this.client&&"open"===this.client.readyState}relayIsReady(){return null!==this.relay&&WebSocket.OPEN===this.relay.readyState}isClosed(a){return void 0===a||WebSocket.CLOSED===a.readyState}peerConnOpen(){return null!==this.pc&&"closed"!==this.pc.connectionState}}ProxyPair.prototype.MAX_BUFFER=10485760,ProxyPair.prototype.pc=null,ProxyPair.prototype.client=null,ProxyPair.prototype.relay=null,ProxyPair.prototype.timer=0,ProxyPair.prototype.flush_timeout_id=null,ProxyPair.prototype.onCleanup=null;class Snowflake{constructor(a,b){this.receiveOffer=this.receiveOffer.bind(this),this.config=a,this.broker=b,this.proxyPairs=[],this.rateLimit=void 0===this.config.rateLimitBytes?new DummyRateLimit:new BucketRateLimit(this.config.rateLimitBytes*this.config.rateLimitHistory,this.config.rateLimitHistory),this.retries=0}setRelayAddr(a){return this.relayAddr=a,!0}beginWebRTC(){return this.pollBroker(),this.pollInterval=setInterval(()=>this.pollBroker(),this.config.defaultBrokerPollInterval)}pollBroker(){var a,b,c;if(b=this.makeProxyPair(),!!b)return a="Polling for client ... ",0<this.retries&&(a+="[retries: "+this.retries+"]"),c=this.broker.getClientOffer(b.id),c.then(a=>this.receiveOffer(b,a)?setTimeout(()=>{if(!b.webrtcIsReady())return b.close()},2e4):b.close(),function(){return b.close()}),this.retries++}receiveOffer(a,b){var c,d;try{return c=JSON.parse(b),d=new SessionDescription(c),!!a.receiveWebRTCOffer(d)&&(this.sendAnswer(a),!0)}catch(a){return!1}}sendAnswer(a){var b,c;return c=function(c){return a.pc.setLocalDescription(c).catch(b)},b=function(){a.close()},a.pc.createAnswer().then(c).catch(b)}makeProxyPair(){if(this.proxyPairs.length>=this.config.maxNumClients)return null;var a;return a=new ProxyPair(this.relayAddr,this.rateLimit,this.config.pcConfig),this.proxyPairs.push(a),a.onCleanup=()=>{var b;if(b=this.proxyPairs.indexOf(a),-1<b)return this.proxyPairs.splice(b,1)},a.begin(),a}disable(){var a;for(clearInterval(this.pollInterval),a=[];0<this.proxyPairs.length;)a.push(this.proxyPairs.pop().close());return a}}Snowflake.prototype.relayAddr=null,Snowflake.prototype.rateLimit=null,Snowflake.prototype.pollInterval=null,Snowflake.MESSAGE={CONFIRMATION:"You're currently serving a Tor user via Snowflake."};class Util{static genSnowflakeID(){return Math.random().toString(36).substring(2)}static hasWebRTC(){return"function"==typeof PeerConnection}static hasCookies(){return navigator.cookieEnabled}}class Parse{static cookie(a){var b,c,d,e,f,g,h,k;for(f={},h=[],a&&(h=a.split(";")),(b=0,d=h.length);b<d;b++){if(g=h[b],c=g.indexOf("="),-1===c)return null;e=decodeURIComponent(g.substr(0,c).trim()),k=decodeURIComponent(g.substr(c+1).trim()),e in f||(f[e]=k)}return f}static address(a){var b,c,d;return(c=null,c||(c=a.match(/^\[([\0-9a-fA-F:.]+)\]:([0-9]+)$/)),c||(c=a.match(/^([0-9.]+):([0-9]+)$/)),!c)?null:(b=c[1],d=parseInt(c[2],10),isNaN(d)||0>d||65535<d?null:{host:b,port:d})}static byteCount(a){let b=a.match(/^(\d+(?:\.\d*)?)(\w*)$/);if(null===b)return null;let c=+b[1];if(isNaN(c))return null;const d=new Map([["",1],["k",1024],["m",1048576],["g",1073741824]]);let e=b[2].toLowerCase();if(!d.has(e))return null;let f=d.get(e);return c*f}static ipFromSDP(a){var b,c,d,e,f;for(f=[/^c=IN IP4 ([\d.]+)(?:(?:\/\d+)?\/\d+)?(:? |$)/m,/^c=IN IP6 ([0-9A-Fa-f:.]+)(?:\/\d+)?(:? |$)/m],b=0,c=f.length;b<c;b++)if(e=f[b],d=e.exec(a),null!=d)return d[1]}}class Params{static getBool(a,b,c){if(!a.has(b))return c;var d;return d=a.get(b),"true"===d||"1"===d||""===d||"false"!==d&&"0"!==d&&null}static getByteCount(a,b,c){return a.has(b)?Parse.byteCount(a.get(b)):c}}class BucketRateLimit{constructor(a,b){this.capacity=a,this.time=b}age(){var a,b;if(b=new Date,a=(b-this.lastUpdate)/1e3,this.lastUpdate=b,this.amount-=a*this.capacity/this.time,0>this.amount)return this.amount=0}update(a){return this.age(),this.amount+=a,this.amount<=this.capacity}when(){return this.age(),(this.amount-this.capacity)/(this.capacity/this.time)}isLimited(){return this.age(),this.amount>this.capacity}}BucketRateLimit.prototype.amount=0,BucketRateLimit.prototype.lastUpdate=new Date;class DummyRateLimit{constructor(a,b){this.capacity=a,this.time=b}update(){return!0}when(){return 0}isLimited(){return!1}}class WS{static buildUrl(a,b,c,d,e){var f;return f=[],f.push(encodeURIComponent(a)),f.push("://"),b.match(/:/)&&!b.match(/[[\]]/)?(f.push("["),f.push(b),f.push("]")):f.push(encodeURIComponent(b)),void 0!==c&&this.DEFAULT_PORTS[a]!==c&&(f.push(":"),f.push(encodeURIComponent(c.toString()))),void 0!==d&&""!==d&&(!d.match(/^\//)&&(d="/"+d),d=d.replace(/[^/]+/,function(a){return encodeURIComponent(a)}),f.push(d)),void 0!==e&&(f.push("?"),f.push(new URLSearchParams(e).toString())),f.join("")}static makeWebsocket(a,b){var c,d,e;return e=this.WSS_ENABLED?"wss":"ws",c=this.buildUrl(e,a.host,a.port,"/",b),d=new WebSocket(c),d.binaryType="arraybuffer",d}static probeWebsocket(a){return new Promise((b,c)=>{const d=WS.makeWebsocket(a);d.onopen=()=>{b(),d.close()},d.onerror=()=>{c(),d.close()}})}}WS.WSS_ENABLED=!0,WS.DEFAULT_PORTS={http:80,https:443},("undefined"!=typeof module&&null!==module?module.exports:void 0)?(window={},document={getElementById:function(){return null}},chrome={},location={search:""},({URLSearchParams}=require("url")),("undefined"==typeof TESTING||null===TESTING||!TESTING)&&(webrtc=require("wrtc"),PeerConnection=webrtc.RTCPeerConnection,IceCandidate=webrtc.RTCIceCandidate,SessionDescription=webrtc.RTCSessionDescription,WebSocket=require("ws"),({XMLHttpRequest}=require("xmlhttprequest")))):(PeerConnection=window.RTCPeerConnection||window.mozRTCPeerConnection||window.webkitRTCPeerConnection,IceCandidate=window.RTCIceCandidate||window.mozRTCIceCandidate,SessionDescription=window.RTCSessionDescription||window.mozRTCSessionDescription,WebSocket=window.WebSocket,XMLHttpRequest=window.XMLHttpRequest);var COOKIE_NAME="snowflake-allow",COOKIE_LIFETIME="Thu, 01 Jan 2038 00:00:00 GMT",COOKIE_EXPIRE="Thu, 01 Jan 1970 00:00:01 GMT";function setSnowflakeCookie(a,b){document.cookie=`${COOKIE_NAME}=${a}; path=/; expires=${b};`}var debug,snowflake,config,broker,init,update,silenceNotifications,query;(function(){snowflake=null,query=new URLSearchParams(location.search),debug=Params.getBool(query,"debug",!1),silenceNotifications=Params.getBool(query,"silent",!1),update=function(){const a=Parse.cookie(document.cookie);return"1"===a[COOKIE_NAME]?Util.hasWebRTC()?void WS.probeWebsocket(config.relayAddr).then(()=>{snowflake.setRelayAddr(config.relayAddr),snowflake.beginWebRTC()},()=>{snowflake.disable()}):void snowflake.disable():void snowflake.disable()},init=function(){Util.hasCookies()&&(config=new Config("badge"),"off"!==query.get("ratelimit")&&(config.rateLimitBytes=Params.getByteCount(query,"ratelimit",config.rateLimitBytes)),broker=new Broker(config),snowflake=new Snowflake(config,broker),update(),setSnowflakeCookie("1",COOKIE_LIFETIME),update())},window.onbeforeunload=function(){return silenceNotifications||null===snowflake?null:Snowflake.MESSAGE.CONFIRMATION},window.onunload=function(){return null!==snowflake&&snowflake.disable(),null},window.onload=function(){init()}})();