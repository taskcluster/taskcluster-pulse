let debug             = require('debug')('taskcluster-pulse');
let appsetup          = require('taskcluster-lib-app');
let loader            = require('taskcluster-lib-loader');
let config            = require('typed-env-config');
let monitor           = require('taskcluster-lib-monitor');
let validator         = require('taskcluster-lib-validate');
let docs              = require('taskcluster-lib-docs');
let _                 = require('lodash');
let v1                = require('./api');

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

  api: {
    requires: ['cfg', 'monitor', 'validator'],
    setup: ({cfg, monitor, validator}) => v1.setup({
      context:          {},
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
