const assert = require('assert');
const path = require('path');
const _ = require('lodash');
const mocha = require('mocha');
const taskcluster = require('taskcluster-client');
const config = require('typed-env-config');
const {fakeauth, stickyLoader, Secrets} = require('taskcluster-lib-testing');
const amqp = require('amqplib');
const builder = require('../src/v1');
const load = require('../src/main');
const data = require('../src/data');

exports.load = stickyLoader(load);

suiteSetup(async function() {
  exports.load.inject('profile', 'test');
  exports.load.inject('process', 'test');
});

// set up the testing secrets
exports.secrets = new Secrets({
  secretName: 'project/taskcluster/testing/taskcluster-secrets',
  secrets: {
    taskcluster: [
      {env: 'TASKCLUSTER_ROOT_URL', cfg: 'taskcluster.rootUrl', name: 'rootUrl'},
      {env: 'TASKCLUSTER_CLIENT_ID', cfg: 'taskcluster.credentials.clientId', name: 'clientId'},
      {env: 'TASKCLUSTER_ACCESS_TOKEN', cfg: 'taskcluster.credentials.accessToken', name: 'accessToken'},
    ],
    rabbitmq: [
      {env: 'RABBIT_USERNAME', cfg: 'rabbit.username', name: 'username'},
      {env: 'RABBIT_PASSWORD', cfg: 'rabbit.password', name: 'password'},
      {env: 'RABBIT_BASE_URL', cfg: 'rabbit.baseUrl', name: 'baseUrl'},
    ],
  },
  load: exports.load,
});

/**
 * Fail with a useful error message if the rabbitmq secrets aren't set.  We
 * require this for most runs, since there's not much sense testing tc-pulse
 * without rabbitmq, and since it's easy to set up a docker container to run
 * rabbitmq.
 */

exports.withRabbitMq = (mock, skipping) => {
  suiteSetup('check for rabbitmq', function() {
    if (!skipping() && !exports.secrets.have('rabbitmq')) {
      throw new Error('RabbitMQ secrets (RABBIT_{USERNAME,PASSWORD,BASE_URL} ' +
        'are required for this suite');
    }
  });
};

/**
 * Set helper.Namespace and helper.RabbitQueue to fully-configured entity
 * objects, and inject them into the loader. These tables are cleared at
 * suiteSetup, but not between test cases.
 */
exports.withEntities = (mock, skipping) => {
  suiteSetup('withEntities', async function() {
    if (skipping()) {
      return;
    }
    
    if (mock) {
      const cfg = await exports.load('cfg');
      exports.load.inject('Namespace', data.Namespace.setup({
        tableName: 'Namespace',
        credentials: 'inMemory',
      }));
      exports.load.inject('RabbitQueue', data.RabbitQueue.setup({
        tableName: 'RabbitQueue',
        credentials: 'inMemory',
      }));
    }
    
    exports.Namespace = await exports.load('Namespace');
    await exports.Namespace.ensureTable();
    
    exports.RabbitQueue = await exports.load('RabbitQueue');
    await exports.RabbitQueue.ensureTable();
  });
  
  const cleanup = async () => {
    if (!skipping()) {
      await exports.Namespace.scan({}, {handler: ent => ent.remove()});
      await exports.RabbitQueue.scan({}, {handler: ent => ent.remove()});
    }
  };
  suiteSetup('withEntities cleanup', cleanup);
  teardown('withEntities cleanup', cleanup);
};

/**
 * Set up an API server.  Call this after withEntities, so the server
 * uses the same entity class.
 *
 * This also sets up helper.client as an API client generator, taking a list
 * of scopes (defaulting to ['*'])
 */
exports.withServer = (mock, skipping) => {
  let webServer;
  
  suiteSetup('withServer', async function() {
    if (skipping()) {
      return;
    }
    const cfg = await exports.load('cfg');

    // even if we are using a "real" rootUrl for access to Azure, we use
    // a local rootUrl to test the API, including mocking auth on that
    // rootUrl.
    const rootUrl = 'http://localhost:60403';
    exports.load.cfg('taskcluster.rootUrl', rootUrl);
    fakeauth.start({'test-client': ['*']}, {rootUrl});

    const ApiClient = taskcluster.createClient(builder.reference());

    exports.client = scopes => new ApiClient({
      credentials: {
        clientId: 'test-client',
        accessToken: 'unused',
        authorizedScopes: scopes,
      },
      rootUrl,
    });
    
    webServer = await exports.load('server');
  });
  
  suiteTeardown('withServer', async function() {
    if (skipping()) {
      return;
    }
    if (webServer) {
      await webServer.terminate();
      webServer = null;
    }
    fakeauth.stop();
  });
};

/**
 * Set up helper.channel() to get an amqp channel (and automatically
 * destroy all such channels at suite completion)
 */
exports.withAmqpChannels = (mock, skipping) => {
  const connections = [];

  suiteSetup('withAmqpChannels', async function() {
    if (skipping()) {
      return;
    }

    const cfg = await exports.load('cfg');
    exports.channel = async () => {
      const connection = await amqp.connect(cfg.app.amqpUrl);
      connections.push(connection);
      return await connection.createChannel();
    };
  });

  suiteTeardown('withAmqpChannels', async function() {
    if (skipping()) {
      return;
    }

    await Promise.all(connections.map(conn => conn.close()));
    delete exports.channel;
  });
};
