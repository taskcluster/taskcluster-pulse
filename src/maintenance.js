let taskcluster = require('taskcluster-client');
let _ = require('lodash');
let slugid = require('slugid');
let assert = require('assert');
let Debug = require('debug');

let setPulseUser = async function({username, password, namespace, rabbitManager, cfg}) {
  await rabbitManager.createUser(username, password, cfg.app.userTags);

  await rabbitManager.setUserPermissions(
    username,
    cfg.app.virtualhost,
    cfg.app.userConfigPermission.replace(/{{namespace}}/g, namespace),
    cfg.app.userWritePermission.replace(/{{namespace}}/g, namespace),
    cfg.app.userReadPermission.replace(/{{namespace}}/g, namespace),
  );
};

/*
 * Attempt to create a new namespace entry and associated Rabbit user.
 * If the requested namespace exists, update it with any user-supplied settings,
 * and return it.
 */
module.exports.claim = async function({Namespace, cfg, rabbitManager, namespace, contact, expires}) {
  let newNamespace;
  let created;

  try {
    newNamespace = await Namespace.create({
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
    newNamespace = await Namespace.load({namespace: namespace});

    // If this claim contains different information, update it accordingly
    if (!_.isEqual(
      {expires: newNamespace.expires, contact: newNamespace.contact},
      {expires, contact})) {
      await newNamespace.modify(entity => {
        entity.expires = expires;
        entity.contact = contact;
      });

      newNamespace = await Namespace.load({namespace: namespace});
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

module.exports.delete = async function({Namespace, rabbitManager, cfg, namespace}) {
  let debug = Debug('delete');

  // use the configuration regexp to determine if an object is owned by this user
  let owned = new RegExp(cfg.app.userConfigPermission.replace(/{{namespace}}/g, namespace));

  // find the user's exchanges and queues
  let exchanges = _.filter(await rabbitManager.exchanges(),
    e => e.vhost === cfg.app.virtualhost && owned.test(e.name));
  let queues = _.filter(await rabbitManager.queues(),
    q => q.vhost === cfg.app.virtualhost && owned.test(q.name));

  // delete sequentually to avoid overloading the rabbitmq server
  for (let i = 0; i < exchanges.length; i++) {
    let name = exchanges[i].name;
    debug(`deleting exchange ${name}`);
    await rabbitManager.deleteExchange(name, cfg.app.virtualhost);
  }
  for (let i = 0; i < queues.length; i++) {
    let name = queues[i].name;
    debug(`deleting queue ${name}`);
    await rabbitManager.deleteQueue(name, cfg.app.virtualhost);
  }

  // try to delete both users
  await rabbitManager.deleteUser(`${namespace}-1`, cfg.app.virtualhost);
  await rabbitManager.deleteUser(`${namespace}-2`, cfg.app.virtualhost);

  // finally, delete the table row
  Namespace.remove({namespace});
};

module.exports.expire = async function({Namespace, cfg, rabbitManager, now}) {
  let count = 0;
  let debug = Debug('expire');

  await Namespace.scan({
    expires: Namespace.op.lessThan(now),
  }, {
    limit:            250, // max number of concurrent delete operations
    handler:          async (ns) => {
      count++;
      debug(`deleting expired namespace ${ns.namespace}`);
      await module.exports.delete({Namespace, rabbitManager, cfg, namespace: ns.namespace});
    },
  });
  return count;
};

module.exports.rotate = async function({Namespace, now, cfg, rabbitManager}) {
  let count = 0;
  let debug = Debug('rotate');

  await Namespace.scan({
    nextRotation: Namespace.op.lessThan(now),
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
