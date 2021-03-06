var mongoose = require('mongoose');
var async    = require('async');
var sha1     = require('sha1');
var _        = require('underscore');
var vucoin   = require('vucoin');
var rawer    = require('../lib/rawer');
var Schema   = mongoose.Schema;

var STATUS = {
  ASK: "ASK",
  NEW: "NEW",
  NEW_BACK: "NEW_BACK",
  UP: "UP",
  DOWN: "DOWN",
  NOTHING: "NOTHING"
};
var BMA_REGEXP = /^BASIC_MERKLED_API( ([a-z_][a-z0-9-_.]*))?( ([0-9.]+))?( ([0-9a-f:]+))?( ([0-9]+))$/;

var PeerSchema = new Schema({
  version: String,
  currency: String,
  pub: { type: String, unique: true },
  endpoints: [String],
  signature: String,
  hash: String,
  hash: String,
  block: { type: String },
  statusBlock: { type: String },
  status: { type: String },
  statusSent: { type: String, default: STATUS.NOTHING },
  statusSigDate: { type: Date, default: function(){ return new Date(0); } },
  propagated: { type: Boolean, default: false },
  sigDate: { type: Date, default: function(){ return new Date(0); } },
  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now }
});

PeerSchema.pre('save', function (next) {
  this.updated = Date.now();
  next();
});

PeerSchema.virtual('pubkey').get(function () {
  return this._pubkey;
});

PeerSchema.virtual('pubkey').set(function (am) {
  this._pubkey = am;
});

PeerSchema.methods = {

  keyID: function () {
    return this.pub && this.pub.length > 10 ? this.pub.substring(0, 10) : "Unknown";
  },

  setStatus: function (newStatus, done) {
    if(this.status != newStatus){
      this.status = newStatus;
      this.save(function (err) {
        done(err);
      });
      return;
    }
    else done();
  },
  
  copyValues: function(to) {
    var obj = this;
    ["version", "currency", "pub", "endpoints", "hash", "status", "block", "signature"].forEach(function (key) {
      to[key] = obj[key];
    });
  },
  
  copyValuesFrom: function(from) {
    var obj = this;
    ["version", "currency", "pub", "endpoints", "block", "signature"].forEach(function (key) {
      obj[key] = from[key];
    });
  },
  
  json: function() {
    var obj = this;
    var json = {};
    ["version", "currency", "endpoints", "status", "block", "signature"].forEach(function (key) {
      json[key] = obj[key];
    });
    json.raw = this.getRaw();
    json.pubkey = this.pub;
    return json;
  },

  getBMA: function() {
    var bma = null;
    this.endpoints.forEach(function(ep){
      var matches = !bma && ep.match(BMA_REGEXP);
      if (matches) {
        bma = {
          "dns": matches[2] || '',
          "ipv4": matches[4] || '',
          "ipv6": matches[6] || '',
          "port": matches[8] || 9101
        };
      }
    });
    return bma || {};
  },

  getDns: function() {
    var bma = this.getBMA();
    return bma.dns ? bma.dns : null;
  },

  getIPv4: function() {
    var bma = this.getBMA();
    return bma.ipv4 ? bma.ipv4 : null;
  },

  getIPv6: function() {
    var bma = this.getBMA();
    return bma.ipv6 ? bma.ipv6 : null;
  },

  getPort: function() {
    var bma = this.getBMA();
    return bma.port ? bma.port : null;
  },

  getHost: function() {
    var bma = this.getBMA();
    var host =
      (bma.ipv6 ? bma.ipv6 :
        (bma.ipv4 ? bma.ipv4 :
          (bma.dns ? bma.dns : '')));
    return host;
  },

  getURL: function() {
    var bma = this.getBMA();
    var base =
      (bma.ipv6 ? '[' + bma.ipv6 + ']' :
        (bma.ipv4 ? bma.ipv4 :
          (bma.dns ? bma.dns : '')));
    if(bma.port)
      base += ':' + bma.port;
    return base;
  },

  getRaw: function() {
    return rawer.getPeerWithoutSignature(this);
  },

  getRawSigned: function() {
    return rawer.getPeer(this);
  },

  connect: function (done){
    var WITH_SIGNATURE_PARAM = false;
    vucoin(this.getIPv6() || this.getIPv4() || this.getDns(), this.getPort(), true, WITH_SIGNATURE_PARAM, done);
  },

  isReachable: function () {
    return this.getURL() ? true : false;
  }
}

PeerSchema.statics.getTheOne = function (fpr, done) {
  var that = this;
  async.waterfall([
    function (next){
      that.find({ pub: fpr }, next);
    },
    function (peers, next){
      if(peers.length == 0){
        next('Unknown peer ' + fpr);
        return;
      }
      else{
        next(null, peers[0]);
      }
    },
  ], done);
};

PeerSchema.statics.getList = function (pubs, done) {
  this.find({ pub: { $in: pubs }}, done);
};

PeerSchema.statics.allBut = function (pubs, done) {
  this.find({ pub: { $nin: pubs } }, done);
};

/**
* Look for 10 last updated peers, and choose randomly 4 peers in it
*/
PeerSchema.statics.getRandomlyWithout = function (pubs, done) {
  var that = this;
  async.waterfall([
    function (next){
      that.find({ pub: { $nin: pubs } })
      .sort({ 'updated': -1 })
      .limit(10)
      .exec(next);
    },
    choose4in
  ], done);
};

/**
* Look for 10 last updated peers, and choose randomly 4 peers in it
*/
PeerSchema.statics.getRandomlyUPsWithout = function (pubs, done) {
  var that = this;
  async.waterfall([
    function (next){
      that.find({ pub: { $nin: pubs }, status: { $in: ['NEW_BACK', 'UP'] } })
      .sort({ 'updated': -1 })
      .limit(10)
      .exec(next);
    },
    choose4in
  ], done);
};

function choose4in (peers, done) {
  var chosen = [];
  var nbPeers = peers.length;
  for (var i = 0; i < Math.min(nbPeers, 4); i++) {
    var randIndex = Math.max(Math.floor(Math.random()*10) - (10 - nbPeers) - i, 0);
    chosen.push(peers[randIndex]);
    peers.splice(randIndex, 1);
  }
  done(null, chosen);
}

PeerSchema.statics.status = STATUS;

module.exports = PeerSchema;
