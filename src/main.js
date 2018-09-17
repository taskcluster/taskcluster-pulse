let debug             = require('debug')('taskcluster-pulse');
let App               = require('taskcluster-lib-app');
let loader            = require('taskcluster-lib-loader');
let config            = require('typed-env-config');
let monitor           = require('taskcluster-lib-monitor');
let SchemaSet         = require('taskcluster-lib-validate');
let Iterate           = require('taskcluster-lib-iterate');
let docs              = require('taskcluster-lib-docs');
let {sasCredentials}  = require('taskcluster-lib-azure');
let _                 = require('lodash');
let builder           = require('./v1');
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
      rootUrl: cfg.taskcluster.rootUrl,
      projectName: cfg.monitoring.project || 'taskcluster-pulse',
      enable: cfg.monitoring.enable,
      credentials: cfg.taskcluster.credentials,
      mock: profile === 'test',
      process,
    }),
  },

  schemaset: {
    requires: ['cfg'],
    setup: ({cfg}) => new SchemaSet({
      serviceName: 'pulse',
      publish: cfg.app.publishMetaData,
      aws: cfg.aws,
    }),
  },

  docs: {
    requires: ['cfg', 'schemaset'],
    setup: ({cfg, schemaset}) => docs.documenter({
      credentials: cfg.taskcluster.credentials,
      tier: 'integrations',
      publish: cfg.app.publishMetaData,
      schemaset,
      references: [
        {name: 'api', reference: builder.reference()},
      ],
    }),
  },

  writeDocs: {
    requires: ['docs'],
    setup: ({docs}) => docs.write({docsDir: process.env['DOCS_OUTPUT_DIR']}),
  },

  Namespace: {
    requires: ['cfg', 'monitor'],
    setup: async ({cfg, monitor}) => data.Namespace.setup({
      tableName: cfg.app.namespaceTableName,
      credentials: sasCredentials({
        accountId: cfg.azure.accountId,
        tableName: cfg.app.namespaceTableName,
        rootUrl: cfg.taskcluster.rootUrl,
        credentials: cfg.taskcluster.credentials,
      }),
      monitor: monitor.prefix(cfg.app.namespaceTableName.toLowerCase()),
    }),
  },

  RabbitQueue: {
    requires: ['cfg', 'monitor'],
    setup: async ({cfg, monitor}) => data.RabbitQueue.setup({
      tableName: cfg.app.rabbitQueueTableName,
      credentials: sasCredentials({
        accountId: cfg.azure.accountId,
        tableName: cfg.app.rabbitQueueTableName,
        rootUrl: cfg.taskcluster.rootUrl,
        credentials: cfg.taskcluster.credentials,
      }),
      monitor: monitor.prefix(cfg.app.namespaceTableName.toLowerCase()),
    }),
  },

  api: {
    requires: ['cfg', 'monitor', 'schemaset', 'rabbitManager', 'Namespace'],
    setup: ({cfg, monitor, schemaset, rabbitManager, Namespace}) => builder.build({
      context:          {cfg, rabbitManager, Namespace},
      rootUrl:          cfg.taskcluster.rootUrl,
      publish:          cfg.app.publishMetaData,
      aws:              cfg.aws,
      monitor:          monitor.prefix('api'),
      schemaset,
    }),
  },

  rabbitManager: {
    requires: ['cfg'],
    setup: ({cfg}) => new RabbitManager(cfg),
  },

  'monitor-rabbit': {
    requires: ['cfg', 'monitor', 'rabbitManager', 'Namespace', 'RabbitQueue'],
    setup: async ({cfg, monitor, rabbitManager, Namespace, RabbitQueue}) => {
      let i = new Iterate({
        maxFailures: cfg.monitor.iterationFails,
        maxIterationTime: cfg.monitor.iterationLength,
        waitTime: cfg.monitor.iterationGap,
        watchDog: 100000, // We don't really use this, but it has to be set
        monitor: monitor.prefix('monitor-rabbit'),
        handler: (watchDog, state) => {
          watchDog.stop();
          return maintenance.monitor({
            cfg,
            manager: rabbitManager,
            Namespace,
            RabbitQueue,
            notify: new taskcluster.Notify(cfg.taskcluster),
          });
        },
      });
      i.start();
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
    setup: ({cfg, api, docs}) => App({
      port: cfg.server.port,
      env: cfg.server.env,
      forceSSL: cfg.server.forceSSL,
      trustProxy: cfg.server.trustProxy,
      apis: [api],
    }),
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
