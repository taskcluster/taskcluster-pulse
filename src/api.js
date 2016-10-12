let API = require('taskcluster-lib-api');
let assert = require('assert');
let debug = require('debug')('taskcluster-pulse');
let taskcluster = require('taskcluster-client');
let slugid = require('slugid');
let _ = require('lodash');

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
    'Namespaces', //An instance of the namespace table manager
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

/*Get an overview of the rabbit cluster*/
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
    _.pick(
      await this.rabbit.overview(),
      ['rabbitmq_version', 'cluster_name', 'management_version']
    )
  );
});

/*Gets the namespace, creates one if one doesn't exist*/
api.declare({
  method:   'get',
  route:    '/namespace/:namespace',
  name:     'namespace',
  title:    'Create a namespace',	
  scopes:   [
    ['pulse:namespace:<namespace>'],
  ],
  //todo later: deferAuth: true,
  description: [
    'Creates a namespace, given the taskcluster credentials with scopes.',
    '',
    '**Warning** this api end-point is **not stable**.',
  ].join('\n'),
}, async function(req, res) {
  let {namespace} = req.params;
  let newNamespace = await setNamespace(this, namespace);
  
  res.reply({
    namespace: newNamespace.namespace,
    username: newNamespace.username,
    password: newNamespace.password,
  });
});

/* Retrieve any entries containing the requested namespace.
 * If an entry exists, use it. Otherwise, create a new entry and an associated rabbit user.*/
async function setNamespace(context, namespace) {
  
  let data = await context.Namespaces.query({
    namespace:     context.Namespaces.op.equal(namespace),
  }, {
    limit:         250, 
  });

  let newNamespace;
  let entryDNE = data.entries.length === 0;
  
  if (entryDNE) {
    newNamespace = createTableEntry(context, namespace);
    await context.rabbit.setUserPermissions(
      user =  await context.rabbit.createUser(newNamespace.username, newNamespace.password, ['taskcluster-pulse']),
      vhost             =  '/',
      configurePattern  = '',
      writePattern      = 'taskcluster/(exchanges|queues)/' + newNamespace.namespace + '/.*',
      readPattern       = 'taskcluster/exchanges/.*'
    ); 
  } else { 
    newNamespace = data.entries[0]; 
  } 
  return newNamespace;
}

async function createTableEntry(context, namespace) {
  return await context.Namespaces.create({
    namespace: namespace,
    username: slugid.v4(),
    password: slugid.v4(),
    created:  new Date(),
    expires:  taskcluster.fromNow('1 day'),
  });
}
