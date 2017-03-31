let assert = require('assert');
let Entity = require('azure-entities');
let taskcluster = require('taskcluster-client');
let slugid = require('slugid');
let RabbitManager = require('../lib/rabbitmanager');
let _ = require('lodash');
let Debug = require('debug');

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

    rv.username = this.username();
    rv.password = this.password;
    rv.reclaimAt = reclaimAt.toJSON();
  }

  return rv;
};

Namespace.prototype.username = function() {
  return `${this.namespace}-${this.rotationState}`;
};

let setPulseUser = async function({username, password, namespace, rabbitManager, cfg}) {
  await rabbitManager.createUser(username, password, cfg.app.userTags);

  await rabbitManager.setUserPermissions(
    username,
    cfg.app.virtualhost,
    cfg.app.userConfigPermission.replace(/{{namespace}}/, namespace),
    cfg.app.userWritePermission.replace(/{{namespace}}/, namespace),
    cfg.app.userReadPermission.replace(/{{namespace}}/, namespace),
  );
};

/*
 * Attempt to create a new namespace entry and associated Rabbit user.
 * If the requested namespace exists, update it with any user-supplied settnigs,
 * and return it.
 */
Namespace.claim = async function({cfg, rabbitManager, namespace, contact, expires}) {
  let newNamespace;
  let created;

  try {
    newNamespace = await Entity.create.call(this, {
      namespace: namespace,
      username: namespace,
      password: slugid.v4(),
      created: new Date(),
      expires,
      rotationState:  '1',
      nextRotation: taskcluster.fromNow(cfg.app.namespaceRotationInterval),
      contact,
    });

    created = true;
  } catch (err) {
    if (err.code !== 'EntityAlreadyExists') {
      throw err;
    }

    created = false;

    // get the existing row
    newNamespace = await Entity.load.call(this, {namespace: namespace});

    // If this claim contains different information, update it accordingly
    if (!_.isEqual(
      {expires: newNamespace.expires, contact: newNamespace.contact},
      {expires, contact})) {
      await newNamespace.modify(entity => {
        entity.expires = expires;
        entity.contact = contact;
      });

      newNamespace = await Entity.load.call(this, {namespace: namespace});
    }
  }

  if (created) {
    // set up the first user as active,
    await setPulseUser({
      username: `${namespace}-1`,
      password: newNamespace.password,
      namespace, cfg, rabbitManager});
    // ..and the second user as inactive (empty string means no logins allowed)
    await setPulseUser({
      username: `${namespace}-2`,
      password: '',
      namespace, cfg, rabbitManager});
  }

  return newNamespace;
};

Namespace.expire = async function(now) {
  assert(now instanceof Date, 'now must be given as option');
  let count = 0;
  await Entity.scan.call(this, {
    expires:          Entity.op.lessThan(now),
  }, {
    limit:            250, // max number of concurrent delete operations
    handler:          (ns) => {
      count++;
      return ns.remove(true);
    },
  });
  return count;
};

Namespace.rotate = async function(now, cfg, rabbitManager) {
  let count = 0;
  let debug = Debug('rotate');

  await Entity.scan.call(this, {
    nextRotation:          Entity.op.lessThan(now),
  }, {
    limit:            250, // max number of concurrent modify operations
    handler:          async (ns) => {
      count++;
      debug(`rotating ${ns.namespace}`);
      let password = slugid.v4();
      let rotationState = ns.rotationState === '1' ? '2' : '1';

      // modify user in rabbitmq
      await setPulseUser({
        username: `${ns.namespace}-${rotationState}`,
        password,
        namespace: ns.namespace,
        cfg, rabbitManager});

      // modify ns in table
      await ns.modify((entity) => {
        entity.rotationState = rotationState;
        entity.nextRotation = taskcluster.fromNow(cfg.app.namespaceRotationInterval),
        entity.password = password;
      });
    },
  });
  return count;
};

module.exports = {Namespace};

