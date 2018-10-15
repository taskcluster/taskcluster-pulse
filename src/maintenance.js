let taskcluster = require('taskcluster-client');
let _ = require('lodash');
let slugid = require('slugid');
let assert = require('assert');
let Debug = require('debug');

let setPulseUser = async function({username, password, namespace, rabbitManager, cfg}) {
  await rabbitManager.createUser(username, password, cfg.app.userTags);

  await rabbitManager.setUserPermissions(
    username,
    cfg.app.amqpVhost,
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
      namespace,
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
      username: `${newNamespace.username(cfg, '1')}`,
      password: newNamespace.password,
      namespace, cfg, rabbitManager});
    // ..and the second user as inactive (empty string means no logins allowed)
    await setPulseUser({
      username: `${newNamespace.username(cfg, '2')}`,
      password: '',
      namespace, cfg, rabbitManager});
  }

  return newNamespace;
};

module.exports.expire = async function({Namespace, cfg, rabbitManager, now}) {
  let count = 0;
  let debug = Debug('maintenance.expire');

  await Namespace.scan({
    expires: Namespace.op.lessThan(now),
  }, {
    limit:            250, // max number of concurrent delete operations
    handler:          async (ns) => {
      count++;
      debug(`deleting expired namespace ${ns.namespace}`);

      // delete both users. NOTE: this does not terminate any active
      // connections these users may have!  Connection termination is left to
      // the RabbitMonitor.
      await rabbitManager.deleteUser(`${ns.username(cfg, '1')}`, cfg.app.amqpVhost);
      await rabbitManager.deleteUser(`${ns.username(cfg, '2')}`, cfg.app.amqpVhost);

      // finally, delete the table row
      await Namespace.remove({namespace: ns.namespace});
    },
  });
  return count;
};

module.exports.rotate = async function({Namespace, now, cfg, rabbitManager}) {
  let count = 0;
  let debug = Debug('maintenance.rotate');

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
        username: ns.username(cfg, rotationState),
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

function decideState(queue, cfg) {
  let currentState = 'normal';
  let subject = `${queue.name} has returned to a safe state`;
  let content = `
The number of messages queued in \`${queue.name}\` is now below ${cfg.monitor.alertThreshold}.
No further action is necessary on your part, although you may want to investigate
why this happened in the first place.`;

  if (queue.messages > cfg.monitor.deleteThreshold) {
    currentState = 'danger';
    subject = `${queue.name} has been deleted!`;
    content = `
The number of messages queued in \`${queue.name}\` exceeded ${cfg.monitor.deleteThreshold}.
At the time of deletion, there were ${queue.messages} messages in the queue.`;
  } else if (queue.messages > cfg.monitor.alertThreshold) {
    currentState = 'warning';
    subject = `${queue.name} is in danger of being deleted!`;
    content = `
The number of messages queued in \`${queue.name}\` is now above ${cfg.monitor.alertThreshold}.
Currently there are ${queue.messages} messages in the queue. If this number goes
above ${cfg.monitor.deleteThreshold}, the queue will be deleted and all of the messages
will be lost.

A common cause of this situation is that your service has crashed.`;
  }
  return {currentState, subject, content};
}

async function updateQueueStatus(name, currentState, RabbitQueue) {
  let rq;
  let sendMessage = false;
  try {
    rq = await RabbitQueue.load({name});

    // only initiate a modify operation if we need to; concurrent state
    // updates will be disambiguated yb the inner `if`.
    if (rq.state !== currentState) {
      rq.modify((entity) => {
        if (entity.state !== currentState) {
          entity.state = currentState;
          entity.updated = new Date();
          sendMessage = true;
        }
      });
    }
  } catch (e) {
    if (e.code !== 'ResourceNotFound') {
      throw e;
    }
    rq = await RabbitQueue.create({
      name,
      state: currentState,
      updated: new Date(),
    });
    if (currentState !== 'normal') {
      sendMessage = true;
    }
  }
  return sendMessage;
}

async function handleQueues({cfg, manager, namespaces, RabbitQueue, notify, virtualhost, mock}) {
  let debug = Debug('maintenance.handle-queues');
  let queues = await manager.queues(virtualhost);
  for (let queue of queues) {
    if (!queue.name.startsWith(cfg.monitor.queuePrefix + cfg.app.namespacePrefix)) {
      continue; // Note: This is very important to avoid stepping on pulseguardian's toes
    }

    let namespace = queue.name.slice(cfg.monitor.queuePrefix.length).split('/')[0];
    let ns = _.find(namespaces, {namespace});

    if (!ns) {
      // We get rid of any queues from namespaces that are gone
      debug(`deleting ${queue.name} with ${queue.messages} messages because namespace is expired.`);
      if (!mock) {
        await manager.deleteQueue(queue.name, virtualhost);
      }
      continue;
    }

    let {currentState, subject, content} = decideState(queue, cfg);

    // First we'll send any notifications that we can
    if (await updateQueueStatus(queue.name, currentState, RabbitQueue)) {

      if (ns.contact) {
        debug(`Sending a ${currentState} notification for ${queue.name} to ${ns.contact}`);
        if (!mock) {
          await notify.email({
            address: ns.contact,
            subject,
            content,
          });
        }
      } else {
        debug(`Skipped sending a notification for ${queue.name} because no contact specified`);
      }
    }

    // Finally we'll delete the queues if they're danger-big
    if (currentState === 'danger') {
      debug(`deleting ${queue.name} with ${queue.messages} messages.`);
      if (!mock) {
        await manager.deleteQueue(queue.name, virtualhost);
      }
    }
  }
}

async function handleExchanges({cfg, manager, namespaces, virtualhost, mock}) {
  let debug = Debug('maintenance.handle-exchanges');
  let exchanges = await manager.exchanges(virtualhost);
  for (let exchange of exchanges) {
    if (!exchange.name.startsWith(cfg.monitor.exchangePrefix + cfg.app.namespacePrefix)) {
      continue; // Note: This is very important to avoid stepping on pulseguardian's toes
    }
    let namespace = exchange.name.slice(cfg.monitor.exchangePrefix.length).split('/')[0];
    if (!_.find(namespaces, {namespace})) {
      debug(`Deleting ${exchange.name} because associated namespace is expired!`);
      if (!mock) {
        await manager.deleteExchange(exchange.name, virtualhost);
      }
    }
  }
}

async function handleConnections({cfg, manager, namespaces, virtualhost, mock}) {
  let debug = Debug('maintenance.handle-connections');
  let old = taskcluster.fromNow(cfg.monitor.connectionMaxLifetime);
  let connections = await manager.connections(virtualhost);

  // build a prefix composed of both the uesrname and namespace prefix
  const usernamePrefix = cfg.app.usernamePrefix || '';
  const fullUsernamePrefix = `${usernamePrefix}${cfg.app.namespacePrefix}`;

  for (let connection of connections) {
    if (!(connection.user.startsWith(fullUsernamePrefix) && /-[12]$/.test(connection.user))) {
      continue; // Note: This is very important to avoid stepping on pulseguardian's toes
    }

    let terminate = false;
    let reason = '';
    let namespace = connection.user.slice(usernamePrefix.length, -2);

    if (!_.find(namespaces, {namespace})) {
      debug(`Terminating connection for expired user: ${connection.user}`);
      reason = 'Namespace expired.';
      terminate = true;
    }
    if (old > new Date(connection.connected_at)) {
      debug(`Terminating connection for user: ${connection.user} due to being too long-lived`);
      reason = 'Connection too long lived.';
      terminate = true;
    }

    if (terminate && !mock) {
      await manager.terminateConnection(connection.name, reason).catch(err => {
        if (err.statusCode !== 404) {
          throw err;
        }
      });
    }
  }
}

async function cleanupRabbitQueues({cfg, alertLifetime, RabbitQueue, mock}) {
  let debug = Debug('maintenance.cleanup-rabbit-queues');
  let old = taskcluster.fromNow(alertLifetime);
  let count = 0;

  await RabbitQueue.scan({
    updated: RabbitQueue.op.lessThan(old),
  }, {
    limit:            250, // max number of concurrent delete operations
    handler:          async (qs) => {
      count++;
      debug(`deleting old RabbitQueue azure entity ${qs.name}`);
      if (!mock) {
        await RabbitQueue.remove({name: qs.name});
      }
    },
  });
}

module.exports.monitor = async ({cfg, manager, Namespace, RabbitQueue, notify}) => {
  let debug = Debug('maintenance');
  let alertLifetime = cfg.app.rabbitQueueExpirationDelay;
  let virtualhost = cfg.app.amqpVhost;
  let mock = cfg.app.mockMaintenance;

  if (mock) {
    debug('maintenance running in mock mode');
  }

  let namespaces = [];
  let continuationToken = null;

  await Namespace.scan({}, {
    limit: 250,
    handler: async entry => namespaces.push(entry),
  });

  await handleConnections({cfg, manager, namespaces, virtualhost, mock});

  return await Promise.all([
    handleQueues({cfg, manager, namespaces, RabbitQueue, notify, virtualhost, mock}),
    handleExchanges({cfg, manager, namespaces, virtualhost, mock}),
    cleanupRabbitQueues({cfg, alertLifetime, RabbitQueue, mock}),
  ]);
};
