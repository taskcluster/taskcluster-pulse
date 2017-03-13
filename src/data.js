let assert = require('assert');
let Entity = require('azure-entities');
let taskcluster = require('taskcluster-client');
let slugid = require('slugid');
let RabbitManager = require('../lib/rabbitmanager');

/**
 * Entity for keeping track of pulse user credentials
 *
 */
let Namespace = Entity.configure({
  version:          1,
  partitionKey:     Entity.keys.StringKey('namespace'),
  rowKey:           Entity.keys.ConstantKey('namespace'),
  properties: {
    namespace:      Entity.types.String,
    username:       Entity.types.String,
    password:       Entity.types.String,
    created:        Entity.types.Date,
    expires:        Entity.types.Date,
    rotationState:  Entity.types.String,
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

Namespace.getRotationUsername = function(ns) {
  assert(ns instanceof Namespace, 'ns must be a namespace');
  return ns.username.concat('-').concat(ns.rotationState);
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

Namespace.rotate = async function(now, rabbit) {
  assert(now instanceof Date, 'now must be given as option');
  assert(rabbit instanceof RabbitManager, 'rabbit manager must be given as option');

  let count = 0;
  await Entity.scan.call(this, {
    nextRotation:          Entity.op.lessThan(now),
  }, {
    limit:            250, // max number of concurrent modify operations
    handler:          async (ns) => {
      count++;
      let nextPass = slugid.v4();
      let nextRotationState = ns.rotationState === '1' ? '2' : '1';

      //modify user in rabbitmq
      await rabbit.createOrUpdateUser(ns.username.concat('-').concat(nextRotationState),
                                      nextPass, ['taskcluster-pulse']);

      //modify ns in table
      await ns.modify((entity) => {
        entity.rotationState = nextRotationState;
        entity.nextRotation = taskcluster.fromNow('1 hour');
        entity.password = nextPass;
      });
    },
  });
  return count;
};

module.exports = {Namespace};

