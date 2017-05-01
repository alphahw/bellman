var Bellman = require('./lib/bellman');
var BellmanInstance = new Bellman(require('./config/config.json'));

BellmanInstance.listen();

BellmanInstance.on('newTrack', (newTrack) => {
  console.log('New track! '+JSON.stringify(newTrack));
});