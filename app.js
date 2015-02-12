var request = require('request'),
	Sonos = require('sonos').Sonos,
	Listener = require('sonos/lib/events/listener'),
	xml2js = require('xml2js'),
	util = require('util');

var x = new Listener(new Sonos(process.env.SONOS_HOST || '192.168.0.0'));

x.listen(function(err) {
	
	if (err) throw err;
  
	x.addService('/MediaRenderer/AVTransport/Event', function(error, sid) {
		if (error) throw err;

		// Subscribing so we'll get notified every now and then

		console.log('Successfully subscribed, with subscription id', sid, '\n\n');
	});

	x.on('serviceEvent', function(endpoint, sid, data) {
		//console.log('Received event from', endpoint, '(' + sid + ') with data:', data, '\n\n');

		console.log('Received event from', endpoint, '(' + sid + ')\n\n');

		// Ooh, we got a notification! Let's poke inside…

		xml2js.parseString(data.LastChange, function(err, result) {
			//console.log(util.inspect(result, false, null));

			// First xml2js(ON) pass – however, the CurrentTrackMetaData val is still XML (well, DIDL), so we have to run that through the parser…

			var annoyingJSONPathToMetaData = result.Event.InstanceID[0].CurrentTrackMetaData[0].$.val;

			xml2js.parseString(annoyingJSONPathToMetaData, function(err, result) {
			//console.log(util.inspect(result, false, null));

				// Second xml2js(ON) pass – now we can grab the nice stuff inside! See DIDL parser below.

				var currentTrackMetaData = parseDIDL(result);

				console.log(currentTrackMetaData);

			});

		});

	});
});

// Taken from the innards of the sonos package – couldn't get to it, so here we are.
var parseDIDL = function(didl) {
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