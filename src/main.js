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
let RabbitManager     = require('./rabbitmanager');
let maintenance       = require('./maintenance');

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

  Namespace: {
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

  RabbitQueue: {
    requires: ['cfg', 'monitor'],
    setup: async ({cfg, monitor}) => {
      var rq = data.RabbitQueue.setup({
        account: cfg.azure.account,
        table: cfg.app.rabbitQueueTableName,
        credentials: cfg.taskcluster.credentials,
        monitor: monitor.prefix(cfg.app.rabbitQueueTableName.toLowerCase()),
      });

      await rq.ensureTable(); //create the table
      return rq;
    },
  },

  api: {
    requires: ['cfg', 'monitor', 'validator', 'rabbitManager', 'Namespace'],
    setup: ({cfg, monitor, validator, rabbitManager, Namespace}) => v1.setup({
      context:          {cfg, rabbitManager, Namespace},
      authBaseUrl:      cfg.taskcluster.authBaseUrl,
      publish:          process.env.NODE_ENV === 'production',
      baseUrl:          cfg.server.publicUrl + '/v1',
      referencePrefix:  'pulse/v1/api.json',
      aws:              cfg.aws,
      monitor:          monitor.prefix('api'),
      validator,
    }),
  },

  rabbitManager: {
    requires: ['cfg'],
    setup: ({cfg}) => new RabbitManager(cfg.rabbit),
  },

  'monitor-rabbit': {
    requires: ['cfg', 'monitor', 'rabbitManager', 'Namespace', 'RabbitQueue'],
    setup: async ({cfg, monitor, rabbitManager, Namespace, RabbitQueue}) => {
      debug('Begin an interation of rabbit monitoring');
      await maintenance.monitor({
        cfg,
        manager: rabbitManager,
        Namespace,
        RabbitQueue,
        notify: new taskcluster.Notify(cfg.taskcluster),
      });
      debug('Finish an interation of rabbit monitoring');
      monitor.count('monitor-rabbit.done');
      monitor.stopResourceMonitoring();
      await monitor.flush();
    },
  },

  'expire-namespaces':{
    requires: ['cfg', 'Namespace', 'rabbitManager', 'monitor'],
    setup: async ({cfg, Namespace, rabbitManager, monitor}) => {
      let now = taskcluster.fromNow(cfg.app.namespacesExpirationDelay);

      // Expire namespace entries using delay
      debug('Expiring namespaces at: %s, from before %s', new Date(), now);
      let count = await maintenance.expire({Namespace, cfg, rabbitManager, now});
      debug('Expired %s namespace entries', count);

      monitor.count('expire-namespaces.done');
      monitor.stopResourceMonitoring();
      await monitor.flush();
    },
  },

  'rotate-namespaces':{
    requires: ['cfg', 'Namespace', 'monitor', 'rabbitManager'],
    setup: async ({cfg, Namespace, monitor, rabbitManager}) => {
      let now = new Date();

      debug('Rotating namespaces');
      let count = await maintenance.rotate({Namespace, now, cfg, rabbitManager});
      debug('Rotated %s namespace entries', count);

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
