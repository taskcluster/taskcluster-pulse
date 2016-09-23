let API = require('taskcluster-lib-api');
let debug = require('debug')('taskcluster-pulse');
let _ = require("lodash");

let api = new API({
  title: 'Pulse Management Service',
  description: [
    'The taskcluster-pulse service, typically available at `pulse.taskcluster.net`',
    'manages pulse credentials for taskcluster users.',
    '',
    'A service to manage Pulse credentials for anything using',
    'Taskcluster credentials. This allows us self-service and',
    'greater control within the Taskcluster project.',
  ].join('\n'),
  schemaPrefix: 'http://schemas.taskcluster.net/pulse/v1/',
  context: [
    'rabbit', // An instance of rabbitmanager
  ],
});

module.exports = api;
/** Check that the server is a alive */
api.declare({
  method:   'get',
  route:    '/ping',
  name:     'ping',
  title:    'Ping Server',
  description: [
    'Documented later...',
    '',
    '**Warning** this api end-point is **not stable**.',
  ].join('\n'),
}, function(req, res) {

  res.status(200).json({
    alive:    true,
    uptime:   process.uptime(),
  });
});

api.declare({
  method:   'get',
  route:    '/overview',
  name:     'overview',
  title:    'Rabbit Overview',
  output:	    'rabbit-overview.json',		
  description: [
    'An overview of the Rabbit cluster',
    '',
    '**Warning** this api end-point is **not stable**.',
  ].join('\n'),
}, async function(req, res) {

  res.reply(
    _.pick(await this.rabbit.overview(),['rabbitmq_version','cluster_name','management_version'])
  );
});

