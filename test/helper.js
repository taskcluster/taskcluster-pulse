let assert      = require('assert');
let path        = require('path');
let _           = require('lodash');
let mocha       = require('mocha');
let taskcluster = require('taskcluster-client');
let config      = require('typed-env-config');
let testing     = require('taskcluster-lib-testing');
let Stressor    = require('../.bin/rabbitstressor');
let api         = require('../lib/api');
let load        = require('../lib/main');
let Rabbit      = require('../lib/rabbitmanager');
let Monitor     = require('../lib/rabbitmonitor');
let Alerter     = require('../lib/rabbitalerter');
let data        = require('../lib/data');

// Load configuration
let cfg = config({profile: 'test'});

let testclients = {
  'test-client': ['*'],
  'test-server': ['*'],
};

// Create and export helper object
let helper = module.exports = {};

let webServer = null;

// Setup before tests
mocha.before(async () => {
  // Create mock authentication server
  testing.fakeauth.start(testclients);

  webServer = await load('server', {profile: 'test', process: 'test'});

  // Create client for working with API
  helper.baseUrl = 'http://localhost:' + webServer.address().port + '/v1';
  let reference = api.reference({baseUrl: helper.baseUrl});
  helper.Pulse = taskcluster.createClient(reference);
  helper.pulse = new helper.Pulse({
    baseUrl: helper.baseUrl,
    credentials: cfg.taskcluster.credentials,
  });

  helper.rabbit = new Rabbit(cfg.rabbit);
  helper.stressor = new Stressor(cfg.stressor, cfg.app.amqpUrl, new Rabbit(cfg.rabbit));
  helper.alerter = new Alerter(cfg.alerter, cfg.taskcluster.credentials);
  helper.monitor = new Monitor(
    cfg.monitor,
    cfg.app.amqpUrl,
    new Alerter(cfg.alerter, cfg.taskcluster.credentials),
    new Rabbit(cfg.rabbit),
    helper.pulse
  );
});

mocha.after(async () => {
  await webServer.terminate();
  testing.fakeauth.stop();
});
