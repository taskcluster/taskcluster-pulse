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

api.declare({
/*Get an overview of the rabbit cluster*/
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

api.declare({
/*Gets the namespace, creates one if one doesn't exist*/
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

  await this.Namespaces.ensureTable(); //set up the table if needed

  //check for any entries that contain the requested namespace
  let data = await this.Namespaces.scan({
    namespace:          this.Namespaces.op.equal(namespace),
  }, {
    limit:            250, //what should this value be
  }
  );

  //create a new entry if none exists 
  if (data.entries.length === 0) {
    let username = slugid.v4();
    let password = slugid.v4();
    
    await this.Namespaces.create({
      namespace: namespace,
      username: username,
      password: password,
      created:  new Date(),
      expires:  taskcluster.fromNow('1 day'),
    });

    await this.rabbit.createUser(username, password, 'taskcluster-pulse');
  } else { 
    //what happens if some user requests same namespace?
  }

  //get the entry that was just created
  let retrivedNamespaces = await this.Namespaces.scan(
    {
      namespace:        this.Namespaces.op.equal(namespace)
    }, 
    {
      limit:            250, 
    });
  
  assert(retrivedNamespaces.entries.length === 1, 'Exactly one namespace must exist');

  res.reply(
  //return the namespace entity
    {
      namespace: retrivedNamespaces.entries[0].namespace,
      username: retrivedNamespaces.entries[0].username,
      password: retrivedNamespaces.entries[0].password,
    }
   
  );

});

