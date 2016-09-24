let debug             = require('debug')('taskcluster-pulse');
let appsetup          = require('taskcluster-lib-app');
let loader            = require('taskcluster-lib-loader');
let config            = require('typed-env-config');
let monitor           = require('taskcluster-lib-monitor');
let validator         = require('taskcluster-lib-validate');
let docs              = require('taskcluster-lib-docs');
let _                 = require('lodash');
let v1                = require('./api');
let Rabbit            = require('./rabbitmanager');
let data              = require('./data')

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
      tier: 'core',
      schemas: validator.schemas,
      references: [
        {
          name: 'api',
          reference: v1.reference({baseUrl: cfg.server.publicUrl + '/v1'}),
        },
      ],
    }),
  },

  rabbit: {
    requires: ['cfg'],
    setup: ({cfg}) => new Rabbit(cfg.rabbit),
  },

  Namespaces: {
    requires: ['cfg', 'monitor'],
    setup: async ({cfg, monitor}) => data.Namespace.setup({
      account: cfg.azure.account,
      table: cfg.app.namespaceTableName, 
      credentials: cfg.taskcluster.credentials,
      monitor: monitor.prefix(cfg.app.namespaceTableName.toLowerCase()),
    }),
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

  
  api: {
    requires: ['cfg', 'monitor', 'validator', 'rabbit', 'Namespaces'],
    setup: ({cfg, monitor, validator, rabbit, Namespaces}) => v1.setup({
      context:          {rabbit, Namespaces},
      authBaseUrl:      cfg.taskcluster.authBaseUrl,
      publish:          process.env.NODE_ENV === 'production',
      baseUrl:          cfg.server.publicUrl + '/v1',
      referencePrefix:  'pulse/v1/api.json',
      aws:              cfg.aws,
      monitor:          monitor.prefix('api'),
      validator,
    }),
  },

  server: {
    requires: ['cfg', 'api', 'docs'],
    setup: ({cfg, api, docs}) => {

      debug('Launching server.');
      let app = appsetup(cfg.server);
      app.use('/v1', api);
      return app.createServer();
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
