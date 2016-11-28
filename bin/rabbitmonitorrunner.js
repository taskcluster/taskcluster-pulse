const config = require('typed-env-config');
const testing = require('taskcluster-lib-testing');
const api = require('../lib/api');
const load = require('../lib/main');
const RabbitAlerter = require('../lib/rabbitalerter');
const RabbitManager = require('../lib/rabbitmanager');
const RabbitMonitor = require('../lib/rabbitmonitor');
const RabbitStressor = require('./rabbitstressor');
const taskcluster = require('taskcluster-client');

/**
 *  Sets up the environment to run the RabbitMonitor.
 *
 *  @param {Object} cfg   - TaskCluster Configuration Object
 */
const setup = async (cfg, monitor) => {
  const rabbitManager = new RabbitManager(cfg.rabbit);
  const firstNamespace = 'demo_one';
  const secondNamespace = 'demo_two';
  const firstDemoMessageQueue = `taskcluster/${firstNamespace}`;
  const secondDemoMessageQueue = `taskcluster/${secondNamespace}`;
  await rabbitManager.createQueue(firstDemoMessageQueue);
  await rabbitManager.createQueue(secondDemoMessageQueue);

  const namespaces = await load('Namespaces', {profile: 'test', process: 'test'});
  await namespaces.ensureTable();

  // TODO: Customize the payload fields
  await monitor.pulse.createNamespace(firstNamespace, {
    contact: {
      method: 'email',
      payload: {
        address: 'a@a.com',
        subject: 'subject',
        content: 'content',
      },
    },
  });
  await monitor.pulse.createNamespace(secondNamespace, {
    contact: {
      method: 'irc',
      payload: {
        channel: '#taskcluster-test',
        message: 'test',
      },
    },
  });
};

const run = async () => {
  const cfg = config({profile: 'test'});

  const testclients = {
    'test-client': ['*'],
    'test-server': ['*'],
  };

  testing.fakeauth.start(testclients);

  const webServer = await load('server', {profile: 'test', process: 'test'});

  const baseUrl = 'http://localhost:' + webServer.address().port + '/v1';
  const reference = api.reference({baseUrl: baseUrl});
  const Pulse = taskcluster.createClient(reference);
  const pulseClient = new Pulse({
    baseUrl: baseUrl,
    credentials: cfg.taskcluster.credentials,
  });

  const rabbitMonitor = new RabbitMonitor(
    cfg.monitor,
    cfg.app.amqpUrl,
    new RabbitAlerter(cfg.alerter, cfg.taskcluster.credentials),
    new RabbitManager(cfg.rabbit),
    pulseClient
  );

  await setup(cfg, rabbitMonitor);

  const verbose = true;
  try {
    await rabbitMonitor.run(verbose);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

run();
