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
    'Taskcluster credentials. This allows for self-service pulse',
    'access and greater control within the Taskcluster project.',
  ].join('\n'),
  schemaPrefix: 'http://schemas.taskcluster.net/pulse/v1/',
  context: [
    'cfg',
    'rabbitManager',
    'Namespaces',
  ],
  errorCodes: {
    InvalidNamespace: 400,
  },
});

module.exports = api;

api.declare({
  method:     'get',
  route:      '/overview',
  name:       'overview',
  title:      'Rabbit Overview',
  output:     'rabbit-overview.json',
  stability:  'experimental',
  description: [
    'Get an overview of the Rabbit cluster.',
  ].join('\n'),
}, async function(req, res) {
  res.reply(
    _.pick(
      await this.rabbitManager.overview(),
      ['rabbitmq_version', 'cluster_name', 'management_version']
    )
  );
});

api.declare({
  method:     'get',
  route:      '/exchanges',
  name:       'exchanges',
  title:      'Rabbit Exchanges',
  output:     'exchanges-response.json',
  stability:  'experimental',
  description: [
    'Get a list of all exchanges in the rabbit cluster.  This will include exchanges',
    'not managed by this service, if any exist.',
  ].join('\n'),
}, async function(req, res) {
  res.reply(
    _.map(
      await this.rabbitManager.exchanges(),
      elem => _.pick(elem, ['name', 'vhost', 'type', 'durable', 'auto_delete', 'internal', 'arguments'])
    )
  );
});

// TODO: api method to list namespaces

api.declare({
  method:   'post',
  route:    '/namespace/:namespace',
  name:     'claimNamespace',
  title:    'Claim a namespace',
  input:    'namespace-request.json',
  output:   'namespace-response.json',
  scopes:   [
    ['pulse:namespace:<namespace>'],
  ],
  stability: 'experimental',
  description: [
    'Claim a namespace, returning a username and password with access to that',
    'namespace good for a short time.  Clients should call this endpoint again',
    'at the re-claim time given in the response, as the password will be rotated',
    'soon after that time.  The namespace will expire, and any associated queues',
    'and exchanges will be deleted, at the given expiration time',
  ].join('\n'),
}, async function(req, res) {
  let {namespace} = req.params;
  let contact = req.body.contact; //the contact information

  // TODO: verify user has scopes for the given contact information
  // (requires deferAuth: true)

  // TODO: allow user to specify expiration time

  if (!isNamespaceValid(namespace, this.cfg)) {
    return invalidNamespaceResponse(req, res, this.cfg);
  }

  let newNamespace = await setNamespace(this, namespace, contact);
  res.reply({
    namespace:  newNamespace.namespace,
    username:   this.Namespaces.getRotationUsername(newNamespace),
    password:   newNamespace.password,
    contact:    newNamespace.contact,
    // TODO: return expiration, re-claim time
    // note: returned re-claim time is not nextRotation, as calling
    // before that rotation occurs could result in being told to call
    // again immediately. Think carefully about which time is best.
  });
});

// TODO: remove this method; namespace details should be managed with the
// method above
api.declare({
  method:   'get',
  route:    '/namespace/:namespace',
  name:     'namespace',
  title:    'Get namespace information',
  scopes:   [
    ['pulse:namespace:<namespace>'],
  ],
  //todo later: deferAuth: true,
  stability: 'experimental',
  description: [
    'Gets a namespace, given the taskcluster credentials with scopes.',
  ].join('\n'),
}, async function(req, res) {
  const {namespace} = req.params;

  if (!isNamespaceValid(namespace, this.cfg)) {
    return invalidNamespaceResponse(req, res, this.cfg);
  }

  try {
    const namespaceResponse = await this.Namespaces.load({namespace: namespace});
    res.reply(namespaceResponse);
  } catch (error) {
    return res.reportError('ResourceNotFound',
        `Could not find namespace ${namespace}`,
        {});
  }
});

/**
 * Report an InvalidNamspeace error to the user
 */
function invalidNamespaceResponse(request, response, cfg) {
  let msg = ['Invalid namespace provided.  Namespaces must:'];
  msg.push('* be at most 64 bytes');
  msg.push('* contain only [A-Za-z-0-9_:-]');
  if (cfg.app.namespacePrefix) {
    msg.push(`* begin with "${cfg.app.namespacePrefix}"`);
  }
  return response.reportError('InvalidNamespace', msg.join('\n'), {});
}

/**
 * Check whether this is a valid namespace name, considering both hard-coded
 * limits and the configurable required prefix
 */
function isNamespaceValid(namespace, cfg) {
  if (namespace.length > 64 || !/^[A-Za-z0-9_-]+$/.test(namespace)) {
    return false;
  }
  const prefix = cfg.app.namespacePrefix;
  if (prefix && !namespace.startsWith(prefix)) {
    return false;
  }
  return true;
}

/*
 * Attempt to create a new namespace entry and associated Rabbit user.
 * If the requested namespace exists, return it.
 */
async function setNamespace({rabbitManager, Namespaces}, namespace, contact) {
  let newNamespace;
  try {
    newNamespace = await Namespaces.create({
      namespace:  namespace,
      username:   namespace,
      password:   slugid.v4(),
      created:    new Date(),
      // TODO: make these times configurable
      expires:    taskcluster.fromNow('1 day'),
      rotationState:  '1',
      nextRotation: taskcluster.fromNow('1 hour'),
      contact:    contact,
    });

    await rabbitManager.createUser(namespace.concat('-1'), newNamespace.password, ['taskcluster-pulse']);
    await rabbitManager.createUser(namespace.concat('-2'), newNamespace.password, ['taskcluster-pulse']);

    //set up user pairs in rabbitmq, both users are used for auth rotations
    // TODO: make these configurable too
    await rabbitManager.setUserPermissions(
      namespace.concat('-1'),                                         //username
      '/',                                                            //vhost
      `^taskcluster/(exchanges|queues)/${newNamespace.namespace}/.*`,  //configure pattern
      `^taskcluster/(exchanges|queues)/${newNamespace.namespace}/.*`,  //write pattern
      '^taskcluster/exchanges/.*'                                      //read pattern
      );

    await rabbitManager.setUserPermissions(
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

    // TODO: verify settings are the same, or modify existing settings

    newNamespace = await Namespaces.load({namespace: namespace});
  }
  return newNamespace;
}
