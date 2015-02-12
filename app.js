var request = require('request');
var Sonos = require('sonos').Sonos;
var sonos = new Sonos(process.env.SONOS_HOST || '192.168.0.0', process.env.SONOS_PORT || 1400);

sonos.currentTrack(function(err, track) {
  console.log(err, track);
});