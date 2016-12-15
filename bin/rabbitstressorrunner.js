const config = require('typed-env-config');
const RabbitManager = require('../lib/rabbitmanager');
const RabbitStressor = require('./rabbitstressor');

const run = async () => {
  const cfg = config({profile: 'test'});
  const rabbitManager = new RabbitManager(cfg.rabbit);
  const runner = new RabbitStressor(cfg.stressor, cfg.app.amqpUrl, rabbitManager);
  await runner.connect();

  console.log(`Sending ${runner.messageCount} messages each of size ${runner.payloadSize} to ${runner.targetQueue}...`);
  await runner.run();
  runner.disconnect();
  console.log('All messages have been sent!');
}

run();
