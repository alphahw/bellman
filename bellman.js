var request = require('request'),
  EventEmitter = require('events').EventEmitter,
  Sonos = require('sonos').Sonos,
  Listener = require('sonos/lib/events/listener'),
  parseString = require('xml2js').parseString,
  util = require('util');

var config = {},
  lastCurrentTrackMetaData = null,
  lastPlaying = {},
  sonosInstance = null,
  soundMachine = null,
  subscriptionId = null;

var origConsoleLog = console.log;
console.log = function log() {
  origConsoleLog.apply(null, ['[' + new Date() + ']'].concat(Array.prototype.slice.call(arguments)));
}

function Bellman(options = {}) {
  config = {
    SONOS_HOST: options.SONOS_HOST,
    SLACK_WEBHOOK: options.SLACK_WEBHOOK,
  };
  EventEmitter.call(this);
};

util.inherits(Bellman, EventEmitter);

Bellman.prototype.updateConfig = function(updatedConfig) {
  config = Object.assign(config, updatedConfig);
};

// Let's listen to the sounds… err, UPnP notifications, of the SONOS.

Bellman.prototype.listen = function() {

  // If already set up, clean house
  if (sonosInstance && soundMachine && subscriptionId) {
    soundMachine.removeService(subscriptionId, function() {
      sonosInstance = null;
      soundMachine = null;
      subscriptionId = null;
    });
  }

  sonosInstance = new Sonos(config.SONOS_HOST);
  soundMachine = new Listener(sonosInstance);
  var _this = this;

    soundMachine.listen(function(err) { 

    if (err) {
      throw "[" + new Date() + "] Bellman couldn't listen to SONOS:\n" + err;
      }

    soundMachine.addService('/MediaRenderer/AVTransport/Event', function(error, sid) {
      if (error) throw err;
      subscriptionId = sid;

      // Subscribing so we'll get notified every now and then

      console.log('Successfully subscribed, with subscription id', sid, '\n');
    });

    soundMachine.on('serviceEvent', function(endpoint, sid, data) {
      //console.log('Received event from', endpoint, '(' + sid + ') with data:', data, '\n\n');

      console.log('– – – – – – – – – – – – – – – – – – – – – –\n\n[' + new Date() + '] Received event from', endpoint, '(' + sid + ')\n');

      // Ooh, we got a notification! Let's poke inside…

      parseString(data.LastChange, function(error, result) {
        //console.log(util.inspect(result, false, null));

        if (error) {
          throw "[" + new Date() + "] Bellman couldn't convert xml2js:\n" + error;
        }

        // First xml2js(ON) pass – however, the CurrentTrackMetaData val is still XML (well, DIDL), so we have to run that through the parser, if there's a new track playing

        var annoyingJSONPathToMetaData = result.Event.InstanceID[0].CurrentTrackMetaData[0].$.val;

        // console.log('Parsed JSON still in form of DIDL:\n' + annoyingJSONPathToMetaData + '\n');

        if (lastCurrentTrackMetaData != annoyingJSONPathToMetaData) {

          // Did the current track change? If so, parse the data and pull out goodies

          lastCurrentTrackMetaData = annoyingJSONPathToMetaData;

        } else {

          // No change? Do nothing, except log it.

          lastCurrentTrackMetaData = null;

          console.log('No track change. (Unparsed DIDL level detection; shallow.)\n');

        }

      });

      if (lastCurrentTrackMetaData != null) {

        var currentTrackMetaData = null;

        parseString(lastCurrentTrackMetaData, function(error, result) {
          // console.log(util.inspect(result, false, null));

          if (error) {
            throw "[" + new Date() + "] Bellman couldn't convert xml2js of current track metadata:\n" + error + "\n";
          }

          // Second xml2js(ON) pass – now we can grab the nice stuff inside! See DIDL parser below.

          currentTrackMetaData = _this.parseDIDL(result);

          //console.log(util.inspect(currentTrackMetaData, false, null));

          //return;

        });

        if (currentTrackMetaData != null) {
          _this.checkForNewTrack(currentTrackMetaData);
        }

      }

    });
  
  });

}

// Verify there's a new track playing

Bellman.prototype.checkForNewTrack = function(currentlyPlaying) {

  // If there's nothing in the lastPlaying object, we fill it out…

  if (lastPlaying.title == null &&
    lastPlaying.artist == null &&
    lastPlaying.album == null &&
    lastPlaying.albumArtURI == null &&
    currentlyPlaying.title != ' ') {

    // Yes, not the easiest way to do this – but we're set in case the keys/structure should ever change (needs to be done to the DIDL parser too though)

    lastPlaying.title = currentlyPlaying.title;
    lastPlaying.artist = currentlyPlaying.artist;
    lastPlaying.album = currentlyPlaying.album;
    lastPlaying.albumArtURI = currentlyPlaying.albumArtURI;

    console.log('Filled out null lastPlaying fields.\n');

    console.log(JSON.stringify(lastPlaying) + "\n");

    // And send the whole thing to Slack!

    this.onNewTrack(lastPlaying);

  } else {

  // …else, we check if it's the same song - no need to anything in that case. (However, said non-affecting else block should theoretically never fire now that song change is checked earlier before the DIDL is parsed.)

    if ((lastPlaying.title != currentlyPlaying.title) || (
      currentlyPlaying.title != null &&
      currentlyPlaying.artist != null) || (
      currentlyPlaying.title != 'null' &&
      currentlyPlaying.artist != 'null') &&
      currentlyPlaying.title != ' ') {

      // If it isn't, we update the lastPlaying object!

      lastPlaying.title = currentlyPlaying.title;
      lastPlaying.artist = currentlyPlaying.artist;
      lastPlaying.album = currentlyPlaying.album;
      lastPlaying.albumArtURI = currentlyPlaying.albumArtURI;

      // And send the whole thing to Slack!

      this.onNewTrack(lastPlaying);

    } else {

      console.log('No track change. (Parsed JSON level detection; deep.)\n');

    }

  }

}

Bellman.prototype.onNewTrack = function(newTrackMetadata) {
  this.emit('newTrack', newTrackMetadata);

  if (config.SLACK_WEBHOOK) {
    this.sendToSlack(newTrackMetadata);
  }
}

// Posting the result to Slack

Bellman.prototype.sendToSlack = function(trackMetadata) {

  var payload = {};

  if (trackMetadata.album != null && trackMetadata.album != 'null') {
    // Formatting for bold artist/title line, and italic album line (Slack markdown)
    var artistAndTitle = '*' + trackMetadata.artist + ' – ' + trackMetadata.title + '*';
    var album = '_' + trackMetadata.album + '_';

    payload.text = artistAndTitle + '\n' + album;
  } else {
    // If no album, only show artist and title
    var artistAndTitle = '*' + trackMetadata.artist + ' – ' + trackMetadata.title + '*';

    payload.text = artistAndTitle;
  }

  request({
    uri: config.SLACK_WEBHOOK,
    method: 'POST',
    body: JSON.stringify(payload)
  }, function (error, response, body) {
    if (error) {
      throw "[" + new Date() + "] Bellman couldn't post to Slack:\n" + error + "\n";
    }

    console.log('Successfully sent "' + payload.text + '" to Slack.\n');

  });

}

// Taken from the innards of the sonos package – didn't figure out how to get to it, so here we are for now.
Bellman.prototype.parseDIDL = function(didl) {
  var item;

  if ((!didl) || (!didl['DIDL-Lite']) || (!util.isArray(didl['DIDL-Lite'].item)) || (!didl['DIDL-Lite'].item[0])) return {};
  item = didl['DIDL-Lite'].item[0];
  return {
    title: util.isArray(item['dc:title']) ? item['dc:title'][0]: null,
    artist: util.isArray(item['dc:creator']) ? item['dc:creator'][0]: null,
    album: util.isArray(item['upnp:album']) ? item['upnp:album'][0]: null,
    albumArtURI : util.isArray(item['upnp:albumArtURI']) ? item['upnp:albumArtURI'][0] : null
  };
};

module.exports = Bellman;