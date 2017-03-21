let debug             = require('debug')('taskcluster-pulse');
let app               = require('taskcluster-lib-app');
let loader            = require('taskcluster-lib-loader');
let config            = require('typed-env-config');
let monitor           = require('taskcluster-lib-monitor');
let validator         = require('taskcluster-lib-validate');
let docs              = require('taskcluster-lib-docs');
let _                 = require('lodash');
let v1                = require('./v1');
let taskcluster       = require('taskcluster-client');
let data              = require('./data');
let RabbitAlerter     = require('./rabbitalerter');
let RabbitManager     = require('./rabbitmanager');
let RabbitMonitor     = require('./rabbitmonitor');

// Create component loader
let load = loader({
  cfg: {
    requires: ['profile'],
    setup: ({profile}) => config({profile}),
  },

  monitor: {
    requires: ['process', 'profile', 'cfg'],
    setup: ({process, profile, cfg}) => monitor({
      project: 'taskcluster-pulse',
      credentials: cfg.taskcluster.credentials,
      mock: profile === 'test',
      process,
    }),
  },

  validator: {
    requires: ['cfg'],
    setup: ({cfg}) => validator({
      prefix: 'pulse/v1/',
      aws: cfg.aws,
    }),
  },

  docs: {
    requires: ['cfg', 'validator'],
    setup: ({cfg, validator}) => docs.documenter({
      credentials: cfg.taskcluster.credentials,
      tier: 'integrations',
      schemas: validator.schemas,
      references: [
        {
          name: 'api',
          reference: v1.reference({baseUrl: cfg.server.publicUrl + '/v1'}),
        },
      ],
    }),
  },

  Namespaces: {
    requires: ['cfg', 'monitor'],
    setup: async ({cfg, monitor}) => {
      var ns = data.Namespace.setup({
        account: cfg.azure.account,
        table: cfg.app.namespaceTableName,
        credentials: cfg.taskcluster.credentials,
        monitor: monitor.prefix(cfg.app.namespaceTableName.toLowerCase()),
      });

      await ns.ensureTable(); //create the table
      return ns;
    },
  },

  api: {
    requires: ['cfg', 'monitor', 'validator', 'rabbitManager', 'Namespaces'],
    setup: ({cfg, monitor, validator, rabbitManager, Namespaces}) => v1.setup({
      context:          {rabbitManager, Namespaces},
      authBaseUrl:      cfg.taskcluster.authBaseUrl,
      publish:          process.env.NODE_ENV === 'production',
      baseUrl:          cfg.server.publicUrl + '/v1',
      referencePrefix:  'pulse/v1/api.json',
      aws:              cfg.aws,
      monitor:          monitor.prefix('api'),
      validator,
    }),
  },

  rabbitAlerter: {
    requires: ['cfg'],
    setup: ({cfg}) => new RabbitAlerter(cfg.alerter, cfg.taskcluster.credentials),
  },

  rabbitManager: {
    requires: ['cfg'],
    setup: ({cfg}) => new RabbitManager(cfg.rabbit),
  },

  rabbitMonitor: {
    requires: ['cfg', 'rabbitAlerter', 'rabbitManager'],
    setup: ({cfg, rabbitAlerter, rabbitManager}) => {
      // create an API client for the tc-pulse web service
      const reference = v1.reference({baseUrl: cfg.server.publicUrl + '/v1'});
      const Pulse = taskcluster.createClient(reference);
      const pulseClient = new Pulse({
        credentials: cfg.taskcluster.credentials,
      });

      return new RabbitMonitor(
        cfg.monitor,
        cfg.app.amqpUrl,
        rabbitAlerter,
        rabbitManager,
        pulseClient);
    },
  },

  'expire-namespaces':{
    requires: ['cfg', 'Namespaces', 'monitor'],
    setup: async ({cfg, Namespaces, monitor}) => {
      let now = taskcluster.fromNow(cfg.app.namespacesExpirationDelay);
      assert(!_.isNaN(now), 'Can\'t have NaN as now');

      // Expire namespace entries using delay
      debug('Expiring namespace entry at: %s, from before %s', new Date(), now);
      let count = await Namespaces.expire(now);
      debug('Expired %s namespace entries', count);

      monitor.count('expire-namespaces.done');
      monitor.stopResourceMonitoring();
      await monitor.flush();
    },
  },

  'rotate-namespaces':{
    requires: ['cfg', 'Namespaces', 'monitor', 'rabbitManager'],
    setup: async ({cfg, Namespaces, monitor, rabbitManager}) => {
      let now = taskcluster.fromNow(cfg.app.namespacesRotationDelay);
      assert(!_.isNaN(now), 'Can\'t have NaN as now');

      // rotate namespace username entries using delay
      debug('Rotating namespace entry at: %s, from before %s', new Date(), now);
      let count = await Namespaces.rotate(now, rabbitManager);
      debug('Rotating %s namespace entries', count);

      monitor.count('rotate-namespaces.done');
      monitor.stopResourceMonitoring();
      await monitor.flush();
    },
  },

  server: {
    requires: ['cfg', 'api', 'docs'],
    setup: ({cfg, api, docs}) => {

      debug('Launching server.');
      let pulseApp = app(cfg.server);
      pulseApp.use('/v1', api);
      return pulseApp.createServer();
    },
  },

  'run-monitor': {
    requires: ['rabbitMonitor'],
    setup: ({rabbitMonitor}) => rabbitMonitor.run(true),
  },
}, ['profile', 'process']);

// If this file is executed launch component from first argument
if (!module.parent) {
  load(process.argv[2], {
    process: process.argv[2],
    profile: process.env.NODE_ENV,
  }).catch(err => {
    console.log(err.stack);
    process.exit(1);
  });
}

// Export load for tests
module.exports = load;
