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
    'rabbitManager',
    'Namespaces',
  ],
  errorCodes: {
    InvalidNamespace: 400,
  },
});

module.exports = api;

/**
 * Gets an overview of the rabbit cluster
 */
api.declare({
  method:     'get',
  route:      '/overview',
  name:       'overview',
  title:      'Rabbit Overview',
  output:     'rabbit-overview.json',
  stability:  'experimental',
  description: [
    'An overview of the Rabbit cluster',
  ].join('\n'),
}, async function(req, res) {
  res.reply(
    _.pick(
      await this.rabbitManager.overview(),
      ['rabbitmq_version', 'cluster_name', 'management_version']
    )
  );
});

/**
 * Gets the list of exchanges in the rabbit cluster
 */
api.declare({
  method:     'get',
  route:      '/exchanges',
  name:       'exchanges',
  title:      'Rabbit Exchanges',
  output:     'exchanges-response.json',
  stability:  'experimental',
  description: [
    'A list of exchanges in the rabbit cluster',
  ].join('\n'),
}, async function(req, res) {
  res.reply(
    _.map(
      await this.rabbitManager.exchanges(),
      elem => _.pick(elem, ['name', 'vhost', 'type', 'durable', 'auto_delete', 'internal', 'arguments'])
    )
  );
});

/**
 * Gets the namespace, creates one if one doesn't exist
 */
api.declare({
  method:   'post',
  route:    '/namespace/:namespace',
  name:     'createNamespace',
  title:    'Create a namespace',
  input:    'namespace-request.json',
  output:   'namespace-response.json',
  scopes:   [
    ['pulse:namespace:<namespace>'],
  ],
  //todo later: deferAuth: true,
  stability: 'experimental',
  description: [
    'Creates a namespace, given the taskcluster credentials with scopes.',
  ].join('\n'),
}, async function(req, res) {
  let {namespace} = req.params;
  let contact = req.body.contact; //the contact information

  if (!isNamespaceValid(namespace)) {
    return invalidNamespaceResponse(req, res);
  }

  let newNamespace = await setNamespace(this, namespace, contact);
  res.reply({
    namespace:  newNamespace.namespace,
    username:   this.Namespaces.getRotationUsername(newNamespace),
    password:   newNamespace.password,
    contact:    newNamespace.contact,
  });
});

/**
 * Gets namespace details
 */
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

  if (!isNamespaceValid(namespace)) {
    return invalidNamespaceResponse(req, res);
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
 * @param {Object} request      - An HTTP request object.
 * @param {Object} response     - An HTTP response object.
 * @returns {Object} A 400 error indicating that the namespace was invalid.
 */
function invalidNamespaceResponse(request, response) {
  return response.reportError('InvalidNamespace', [
    'Namespace provided must be at most 64 bytes, and contain only these characters: ',
    '[A-Za-z-0-9_:-]',
  ].join('\n'), {
    namespace:  request.params.namespace,
  });
}

/**
 * @param {string} namespace
 * @returns {Boolean} True if namespace is valid.
 */
function isNamespaceValid(namespace) {
  return namespace.length <= 64 && /^[A-Za-z0-9_-]+$/.test(namespace);
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
      expires:    taskcluster.fromNow('1 day'),
      rotationState:  '1',
      nextRotation: taskcluster.fromNow('1 hour'),
      contact:    contact,
    });

    await rabbitManager.createUser(namespace.concat('-1'), newNamespace.password, ['taskcluster-pulse']);
    await rabbitManager.createUser(namespace.concat('-2'), newNamespace.password, ['taskcluster-pulse']);

    //set up user pairs in rabbitmq, both users are used for auth rotations
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
    newNamespace = await Namespaces.load({namespace: namespace});
  }
  return newNamespace;
}
