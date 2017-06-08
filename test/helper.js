let assert = require('assert');
let path = require('path');
let _ = require('lodash');
let mocha = require('mocha');
let taskcluster = require('taskcluster-client');
let config = require('typed-env-config');
let testing = require('taskcluster-lib-testing');
let amqp = require('amqplib');
let v1 = require('../lib/v1');
let load = require('../lib/main');
let data = require('../lib/data');

// Load configuration
let cfg = config({profile: 'test'});

let testclients = {
  'test-client': ['*'],
  'test-server': ['*'],
};

// Create and export helper object
let helper = module.exports = {};
helper.cfg = cfg;

let webServer = null;

helper.haveRabbitMq = !!cfg.rabbit.username;
helper.requiresRabbitMq = fn => helper.haveRabbitMq ? fn : undefined;

// Setup before tests
mocha.before(async () => {
  // Create mock authentication server
  testing.fakeauth.start(testclients);

  let overwrites = {profile: 'test', process: 'test'};

  // if there are no rabbit credentials, stub out the Rabbit instance;
  // any affected tests should set `this.pending = true` in this case.
  if (!helper.haveRabbitMq) {
    overwrites.rabbit = {};
  }

  webServer = await load('server', overwrites);

  // Create client for working with API
  helper.baseUrl = 'http://localhost:' + webServer.address().port + '/v1';
  let reference = v1.reference({baseUrl: helper.baseUrl});
  helper.Pulse = taskcluster.createClient(reference);
  helper.pulse = new helper.Pulse({
    baseUrl: helper.baseUrl,
    credentials: cfg.taskcluster.credentials,
  });

  helper.rabbit = await load('rabbitManager', overwrites);
  helper.Namespace = await load('Namespace', overwrites);
  helper.RabbitQueue = await load('RabbitQueue', overwrites);

  helper.connection = await amqp.connect(cfg.app.amqpUrl);
  let channel = await helper.connection.createChannel();
  helper.write = (queueName, message) => {
    channel.sendToQueue(queueName, new Buffer(message));
  };
});

mocha.after(async () => {
  await webServer.terminate();
  testing.fakeauth.stop();
  helper.connection.close();
});
