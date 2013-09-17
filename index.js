"use strict";
var mqtt = require('mqtt'),
  events = require('events'),
  util = require('util'),
  client = null;

/**
 * createClient - create an MQTT client
 *
 * @param {Number} [port] - broker port
 * @param {String} [host] - broker host
 * @param {Object} [opts] - keepalive, clientId, retryTimeout
 * @param {Boolean} [tlsOptions] - whether or not to retain the message
 * @api public
 */
function MqttHelper(port, host, opts, secure) {
  if (!port || !host) {
    throw new Error('port and host are required');
  }
  if (!opts) {
    opts = {};
  }

  this.port = port;
  this.host = host;
  this.opts = opts;
  this.secure = secure;

  this.client = null;
  this.waitCloseTimer = null;
  this._cache = [];
  this._index = 0;

  opts.reconnectPeriod = 0;
  opts.retryTimeout = opts.retryTimeout || 2*60*1000;
  opts.waitCloseTimeout = opts.waitCloseTimeout || 60* 1000;

  var self = this;

  (function init() {
    var client;

    console.info('MqttHelper - init()');

    self.reinitTimer = null;

    if (self.client) {
      return;
    }

    if (true === secure) {
      self.client = client = mqtt.createSecureClient(self.port, self.host, self.opts);
    } else {
      self.client = client = mqtt.createClient(self.port, self.host, self.opts);
    }

    client.on('message', self.emit.bind(self, 'message'));
    client.on('connect', function() {
      self.emit('connect');
      self._publish();
    });
    client.on('close', function (err) {
      if (self.client) {
        self.client.destroy();
      self.client = null;
      }
      
      if (self.waitCloseTimer) {
        clearTimeout(self.waitCloseTimer);
        self.waitCloseTimer = null;
      }

      if (self.reinitTimer) { //alrady client is crated or under creating
      self.emit('close');
        return;
      }
     
      self.reinitTimer = setTimeout(init.bind(self), self.opts.retryTimeout);
      self.emit('close');
    });
    client.on('error', function () {
      if (self.client) {
        self.client.destroy();
        self.client = null;
      }

      if (self.waitCloseTimer) {
        clearTimeout(self.waitCloseTimer);
        self.waitCloseTimer = null;
      }

      if (self.reinitTimer) { //alrady client is crated or under creating
        self.emit('error');
        return;
      }

      self.reinitTimer = setTimeout(init.bind(self), self.opts.retryTimeout);
      self.emit('error');
    });
  })();
};

MqttHelper.MAX_CACHE_COUNT = 1000

util.inherits(MqttHelper, events.EventEmitter);

MqttHelper.prototype._publish = function () {
  var self,
      cache,
      index;

  if (!this.client) { // disconnect
    return;
  }

  if (0 === this._cache.length) { // nothing to send
    return;
  }

  if (this.waitCloseTimer) { // under sending
    return;
  }

  self = this;
  cache = this._cache[0];
  
  this.waitCloseTimer = setTimeout(function() {
     console.warn('waitCloseTimer out : try disconnect');
      self.waitCloseTimer = null;
      if (self.client) {
         self.client.destroy();
         self.client = null;
}
    }, this.opts.waitCloseTimeout);

  index = cache.index;
  this.client.publish(cache.topic, cache.message, cache.opts, function (err) {
    if (err) {
      console.warn('MqttHelper.publish/callback error', err);
    }

    if (self.waitCloseTimer) {
      clearTimeout(self.waitCloseTimer);
      self.waitCloseTimer = null;
    }

    if (0 === self._cache.length) { // nothing to send
      console.error('MqttHelper.publish/callback : cache.length is 0');
      return;
    }

    if (index === self._cache[0].index) {
      self._cache.shift();
    } else {
      console.warn('MqttHelper._publish/callback : mismatch index', index, self._cache[0].index);
    }

    self._publish();
  });
};

// same as MQTT.js client.publish
/**
 * publish - publish <message> to <topic>
 *
 * @param {String} topic - topic to publish to
 * @param {String, Buffer} message - message to publish
 * @param {Object} [opts] - publish options, includes:
 *    {Number} qos - qos level to publish on
 *    {Boolean} retain - whether or not to retain the message
 * @param {Function} [callback] - function(err){}
 *    called when publish succeeds or fails
 * @returns {MqttClient} this - for chaining
 * @api public
 *
 * @example client.publish('topic', 'message');
 * @example
 *     client.publish('topic', 'message', {qos: 1, retain: true});
 * @example client.publish('topic', 'message', console.log);
 */
MqttHelper.prototype.publish = function (topic, message, opts) {
  if (this._cache.length <= MqttHelper.MAX_CACHE_COUNT) {
    this._cache.push({index : this._index++, topic : topic, message : message, opts : opts});

    if (this._cache.length > 1) {
      console.warn('MqttHelper.publish : add queue / length', this._cache.length);
    }
  } else {
    console.error('MqttHelper.publish : cache full (%d)', MqttHelper.MAX_CACHE_COUNT);
  }

  this._publish();
};

// same as MQTT.js client.subscribe
/**
 * subscribe - subscribe to <topic>
 *
 * @param {String, Array} topic - topic(s) to subscribe to
 * @param {Object} [opts] - subscription options, includes:
 *    {Number} qos - subscribe qos level
 * @param {Function} [callback] - function(err, granted){} where:
 *    {Error} err - subscription error (none at the moment!)
 *    {Array} granted - array of {topic: 't', qos: 0}
 * @returns {MqttClient} this - for chaining
 * @api public
 * @example client.subscribe('topic');
 * @example client.subscribe('topic', {qos: 1});
 * @example client.subscribe('topic', console.log);
 */
MqttHelper.prototype.subscribe = function () {
  if (this.client) {
    this.client.subscribe.apply(this.client, arguments);
  } else {
    console.error('MqttHelper.subscribe fail');
  }
};

module.exports = MqttHelper;

// EXAMPLE
/*
var topic = 'MqttHelper/test';
var opts = {clientId: 'MqttHelper', keepalive: 60, clean: true,
              will: {topic: topic, payload: 'err - disconnect client', retain: true},
              retryTimeout: 10*1000, waitCloseTimeout: 30*1000};
var mh = new MqttHelper(PORT, 'IP', opts, false);

var index = 0;
setInterval(function () {
  mh.publish(topic, (++index).toString(), {qos: 1, retain: true}, function () { });
}, 1000);

mh.on('connect', function () {
  console.log('connected');

  this.subscribe('pi1/temp1', {qos: 1}, function (err, granted) {
    if (err) {
      console.error('subscribe error:', err);
    }
  });
});

mh.on('message', function (topic, message, packet) {
  console.log(topic + ":" + message);
});

mh.on('close', function () {
  console.log('closed');
  // this.unsubscribe()...
});
*/
