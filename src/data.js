let assert = require('assert');
let Entity = require('azure-entities');
let taskcluster = require('taskcluster-client');
let slugid = require('slugid');
let _ = require('lodash');

/**
 * Entity for keeping track of pulse user credentials
 *
 * Two pulse users are defined for each namespace: "<namespace>-1" and
 * "<namespace>-2". At any time, one of these is "active", and the other
 * is in "standby".  The two are swapped, with the standby user's password
 * reset, on a regular basis.
 *
 * Users should always be given the active username/password, and should
 * be told to get updated credentials before the time that password is
 * reset.
 */
let Namespace = Entity.configure({
  version:          1,
  partitionKey:     Entity.keys.StringKey('namespace'),
  rowKey:           Entity.keys.ConstantKey('namespace'),
  properties: {
    namespace:      Entity.types.String,
    // password for the active username
    password:       Entity.types.String,

    // date at which this namespace was first created
    created:        Entity.types.Date,

    // date at which this user, and all associated queues and exchanges,
    // should be deleted
    expires:        Entity.types.Date,

    // the currently active username suffix ("1" or "2")
    rotationState:  Entity.types.String,

    // date after which the currently active user will become the standby user
    // and the standby user will become active (with a new password). Users of
    // the active password should renew after this time; users of the standby
    // password must renew before this time.
    nextRotation:   Entity.types.Date,

    // contact email, or empty string for no warning
    contact:        Entity.types.String,
  },
});

var buildConnectionString = ({username, password, hostname, protocol, port, vhost}) => {
  // Construct connection string
  return [
    protocol,
    username,
    ':',
    password,
    '@',
    hostname,
    ':',
    port,
    '/',
    encodeURIComponent(vhost),
  ].join('');
};

Namespace.prototype.json = function({cfg, includePassword}) {
  let rv = {
    namespace: this.namespace,
    created: this.created.toJSON(),
    expires: this.expires.toJSON(),
    contact: this.contact.length > 0 ? this.contact : undefined,
  };
  if (includePassword) {
    // calculate the reclaimAt as half the rotation interval past the
    // next rotation time
    let nextRotation = this.nextRotation;
    let rotationAfter = taskcluster.fromNow(cfg.app.namespaceRotationInterval, nextRotation);
    let reclaimAt = new Date(nextRotation.getTime() + (rotationAfter - nextRotation) / 2);

    rv.connectionString = buildConnectionString({
      protocol: cfg.app.amqpProtocol,
      username: this.username(),
      password: this.password,
      hostname: cfg.app.amqpHostname,
      port: cfg.app.amqpPort,
      vhost: cfg.app.amqpVhost,
    });
    rv.reclaimAt = reclaimAt.toJSON();
  }

  return rv;
};

Namespace.prototype.username = function() {
  return `${this.namespace}-${this.rotationState}`;
};

/**
 * Entity for keeping track of various queue state
 *
 * This *must not* be used to keep a clone of any information
 * that can be grabbed from rabbit directly. This is for
 * taskcluster specific metadata.
 */
let RabbitQueue = Entity.configure({
  version:          1,
  partitionKey:     Entity.keys.StringKey('name'),
  rowKey:           Entity.keys.ConstantKey('name'),
  properties: {
    // The name of the queue that is being tracked
    name:      Entity.types.String,

    // The state the queue is in. This will be something like warning or normal.
    state:     Entity.types.String,

    // The last time this entity was updated.
    updated:   Entity.types.Date,
  },
});

module.exports = {RabbitQueue, Namespace};

