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
/*Gets the list of exchanges in the rabbit cluster*/
  method:   'get',
  route:    '/exchanges',
  name:     'exchanges',
  title:    'Rabbit Exchanges',
  //output:     'rabbit-overview.json',   
  description: [
    'An list of exchanges in the rabbit cluster',
    '',
    '**Warning** this api end-point is **not stable**.',
  ].join('\n'),
}, async function(req, res) {
  res.reply(
    _.map(
      await this.rabbit.exchanges(),
      function(elem) {
        return elem.name;
      }
    )
  );
});

api.declare({
/*Gets the namespace, creates one if one doesn't exist*/
  method:   'post',
  route:    '/namespace/:namespace',
  name:     'namespace',
  title:    'Create a namespace',	
  input:    'namespace-request.json',
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
 
  let {namespace} = req.params; //the namespace requested
  let contact = req.body.contact; //the contact information

  //check for any entries that contain the requested namespace
  let data = await this.Namespaces.query({
    namespace:          this.Namespaces.op.equal(namespace),
  }, {
    limit:            250, 
  }
  );

  let newNamespace; //the namespace that will be returned in the response

  if (data.entries.length === 0) {
    //create a new entry if none exists 
    
    newNamespace = await this.Namespaces.create({
      namespace: namespace,
      username: slugid.v4(),
      password: slugid.v4(),
      created:  new Date(),
      expires:  taskcluster.fromNow('1 day'),
      contact:  contact,
    });

    await this.rabbit.createUser(newNamespace.username, newNamespace.password, ['taskcluster-pulse']);

  } else if (data.entries.length === 1) { 
    //if a namespace already exists, use the loaded username & password
    newNamespace = data.entries[0]; 
  } else {
    throw new Error('Exacly one namespace must exist');
  }

  res.reply(
    //return the namespace entity
    {
      namespace: newNamespace.namespace,
      username: newNamespace.username,
      password: newNamespace.password,
      contact:  newNamespace.contact,
    }
   
  );

});

