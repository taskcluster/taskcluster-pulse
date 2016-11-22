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

/**
 * Gets an overview of the rabbit cluster
 */
api.declare({
  method:   'get',
  route:    '/overview',
  name:     'overview',
  title:    'Rabbit Overview',
  output:   'rabbit-overview.json',		
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

/**
 * Gets the list of exchanges in the rabbit cluster
 */
api.declare({
  method:   'get',
  route:    '/exchanges',
  name:     'exchanges',
  title:    'Rabbit Exchanges',  
  output:   'exchanges-response.json',
  description: [
    'A list of exchanges in the rabbit cluster',
    '',
    '**Warning** this api end-point is **not stable**.',
  ].join('\n'),
}, async function(req, res) {
  res.reply( 
    _.map( 
      await this.rabbit.exchanges(),
      elem => JSON.stringify(
        _.pick( 
          elem, 
          ['name', 'vhost', 'type', 'durable', 'auto_delete', 'internal', 'arguments']
        )
      )
    )
  );
});

/**
 * Gets the namespace, creates one if one doesn't exist
 */
api.declare({
  method:   'post',
  route:    '/namespace/:namespace',
  name:     'namespace',
  title:    'Create a namespace',	
  input:    'namespace-request.json',
  output:   'namespace-response.json',
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
  let contact = req.body.contact; //the contact information

  if (namespace.length>64 || !/^[A-Za-z0-9_-]+$/.test(namespace)) {
    return res.status(400).json({
      message: 'Namespace provided must be at most 64 bytes and contain only these characters: [A-Za-z0-9_-]',
      error: {
        namespace:  req.params.namespace,
      },
    });
  }
 
  let newNamespace = await setNamespace(this, namespace, contact);
  res.reply({
    namespace:  newNamespace.namespace,
    username:   this.Namespaces.getRotationUsername(newNamespace),
    password:   newNamespace.password,
    contact:    newNamespace.contact,
  });
});

/* 
 * Attempt to create a new namespace entry and associated Rabbit user.
 * If the requested namespace exists, return it.
 */
async function setNamespace(context, namespace, contact) {
  let newNamespace; 
  try {
    newNamespace = await context.Namespaces.create({
      namespace:  namespace,
      username:   namespace,
      password:   slugid.v4(),
      created:    new Date(),
      expires:    taskcluster.fromNow('1 day'),
      rotationState:  '1',
      nextRotation: taskcluster.fromNow('1 hour'),
      contact:    contact,
    });
    
    await context.rabbit.createUser(namespace.concat('-1'), newNamespace.password, ['taskcluster-pulse']);
    await context.rabbit.createUser(namespace.concat('-2'), newNamespace.password, ['taskcluster-pulse']);
    
    //set up user pairs in rabbitmq, both users are used for auth rotations
    await context.rabbit.setUserPermissions(
      namespace.concat('-1'),                                         //username
      '/',                                                            //vhost
      `^taskcluster/(exchanges|queues)/${newNamespace.namespace}/.*`,  //configure pattern
      `^taskcluster/(exchanges|queues)/${newNamespace.namespace}/.*`,  //write pattern
      '^taskcluster/exchanges/.*'                                      //read pattern
      ); 

    await context.rabbit.setUserPermissions(
      namespace.concat('-2'),                                         //username
      '/',                                                            //vhost
      `^taskcluster/(exchanges|queues)/${newNamespace.namespace}/.*`,  //configure pattern
      `^taskcluster/(exchanges|queues)/${newNamespace.namespace}/.*`,  //write pattern
      '^taskcluster/exchanges/.*'                                      //read pattern
      );   
    
  } catch (err) {
    if (err.code !== 'EntityAlreadyExists') {
      throw err;
    }
    newNamespace = await context.Namespaces.load({namespace: namespace});
  } 
  return newNamespace;
}
