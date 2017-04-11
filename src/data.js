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

    /**
     * Contact object with properties
     * -method
     * -payload
     *
     * See JSON schema for documentation
     */
    contact:        Entity.types.JSON,
  },
});

var buildConnectionString = ({username, password, hostname}) => {
  // Construct connection string
  return [
    'amqps://',         // Ensure that we're using SSL
    username,
    ':',
    password,
    '@',
    hostname,
    ':',
    5671,               // Port for SSL,
  ].join('');
};

Namespace.prototype.json = function({cfg, includePassword}) {
  let rv = {
    namespace: this.namespace,
    created: this.created.toJSON(),
    expires: this.expires.toJSON(),
    contact: this.contact,
  };
  if (includePassword) {
    // calculate the reclaimAt as half the rotation interval past the
    // next rotation time
    let nextRotation = this.nextRotation;
    let rotationAfter = taskcluster.fromNow(cfg.app.namespaceRotationInterval, nextRotation);
    let reclaimAt = new Date(nextRotation.getTime() + (rotationAfter - nextRotation) / 2);

    rv.connectionString = buildConnectionString({
      username:this.username(),
      password: this.password,
      hostname: cfg.app.amqpHostname,
    });
    rv.reclaimAt = reclaimAt.toJSON();
  }

  return rv;
};

Namespace.prototype.username = function() {
  return `${this.namespace}-${this.rotationState}`;
};

module.exports = {Namespace};

