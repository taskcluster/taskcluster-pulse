const assert = require('assert');
const slugid = require('slugid');
const _ = require('lodash');
const helper = require('./helper');

suite('RabbitManager', function() {
  suiteSetup(async function() {
    await helper.secrets.setup();
    helper.load.save();
  });

  suiteTeardown(async function() {
    helper.load.restore();
  });

  helper.withAmqpChannels(false, () => false);
  helper.withRabbitMq(false, () => false);

  let usernames = [];
  let queuenames = [];

  // setup some useful values..
  let cfg, rabbitManager;
  suiteSetup('set cfg and rabbit', async function() {
    cfg = await helper.load('cfg');
    rabbitManager = await helper.load('rabbitManager');
  });

  setup(() => {
    // Generate a list of 5 user names to be used by test cases.  Store the
    // names so that we can make sure they are deleted in teardown.
    // (Names are random to avoid any potential collisions.)
    usernames = [];
    for (let i = 0; i < 5; i++) {
      usernames.push(slugid.v4());
    }
    // Similarly for queue names.
    queuenames = [];
    for (let i = 0; i < 1; i++) {
      queuenames.push(slugid.v4());
    }
  });

  teardown(async () => {
    // TODO: directly send request to RabbitMQ APIs instead of calling these
    // methods to avoid circularity.
    for (let username of usernames) {
      try {
        await rabbitManager.deleteUser(username);
      } catch (e) {
        // Intentianlly do nothing since this user might not have been created.
      }
    }
    for (let queuename of queuenames) {
      try {
        await rabbitManager.deleteQueue(queuename);
      } catch (e) {
        // Intentianlly do nothing since this queue might not have been created.
      }
    }
  });

  // Although this is in fact supposed to be private, we are testing it anyway
  // because of its importance.
  test('encode', async () => {
    assert.equal(rabbitManager.encode('/a b'), '%2Fa%20b');
    assert(_.isEqual(rabbitManager.encode(['/a b', 'a+b']), ['%2Fa%20b', 'a%2Bb']));
  });

  test('overview', async () => {
    const overview = await rabbitManager.overview();
    assert(_.has(overview, 'rabbitmq_version'));
    assert(_.has(overview, 'management_version'));
    assert(_.has(overview, 'cluster_name'));
  });

  test('clusterName', async () => {
    const clusterName = await rabbitManager.clusterName();
    assert(_.has(clusterName, 'name'));
  });

  test('createAndDeleteUser', async () => {
    await rabbitManager.createUser(usernames[0], 'dummy', []);
    await rabbitManager.deleteUser(usernames[0]);
  });

  test('deleteUserException', async () => {
    try {
      await rabbitManager.deleteUser(usernames[0]);
      assert(false);
    } catch (error) {
      assert.equal(error.statusCode, 404);
    }
  });

  test('users', async () => {
    const usersList = await rabbitManager.users();
    assert(usersList instanceof Array);
    // At least we have the user used for connecting to the management API.
    assert(usersList.length > 0);
    assert(_.has(usersList[0], 'name'));
    assert(_.has(usersList[0], 'tags'));
  });

  test('exchanges', async () => {
    const exchanges = await rabbitManager.exchanges();
    assert(exchanges instanceof Array);
    assert(_.has(exchanges[0], 'name'));
  });

  test('usersWithAllTags', async () => {
    await rabbitManager.createUser(usernames[0], 'dummy', ['foo', 'bar']);
    await rabbitManager.createUser(usernames[1], 'dummy', ['foo']);
    await rabbitManager.createUser(usernames[2], 'dummy', ['bar']);
    await rabbitManager.createUser(usernames[3], 'dummy', ['bar', 'foo']);

    const tags = ['foo', 'bar'];
    const usersWithAllTags = await rabbitManager.usersWithAllTags(tags);

    assert(usersWithAllTags.length === 2);
    assert(_.find(usersWithAllTags, {name: usernames[0]}));
    assert(_.find(usersWithAllTags, {name: usernames[3]}));
  });

  test('usersWithAnyTags', async () => {
    await rabbitManager.createUser(usernames[0], 'dummy', ['moo', 'tar']);
    await rabbitManager.createUser(usernames[1], 'dummy', ['moo']);
    await rabbitManager.createUser(usernames[2], 'dummy', ['tar']);
    await rabbitManager.createUser(usernames[3], 'dummy', ['tar', 'moo']);
    await rabbitManager.createUser(usernames[4], 'dummy', ['car', 'moo']);

    const tags = ['tar', 'car'];
    const usersWithAnyTags = await rabbitManager.usersWithAnyTags(tags);

    assert(usersWithAnyTags.length === 4);
    assert(_.find(usersWithAnyTags, {name: usernames[0]}));
    assert(_.find(usersWithAnyTags, {name: usernames[2]}));
    assert(_.find(usersWithAnyTags, {name: usernames[3]}));
    assert(_.find(usersWithAnyTags, {name: usernames[4]}));
  });

  test('userPermissions_singleVhost', async () => {
    await rabbitManager.createUser(usernames[0], 'dummy', []);
    await rabbitManager.setUserPermissions(usernames[0], '/', '.*', '.*', '.*');

    let permissions = await rabbitManager.userPermissions(usernames[0], '/');
    assert(_.has(permissions, 'user'));
    assert(_.has(permissions, 'vhost'));
    // Delete the permission and test the error case.
    await rabbitManager.deleteUserPermissions(usernames[0], '/');
    try {
      await rabbitManager.userPermissions(usernames[0], '/');
      assert(false);
    } catch (error) {
      assert.equal(error.statusCode, 404);
    }
  });

  test('userPermissions_allVhosts', async () => {
    await rabbitManager.createUser(usernames[0], 'dummy', []);
    await rabbitManager.setUserPermissions(usernames[0], '/', '.*', '.*', '.*');

    let permissions = await rabbitManager.userPermissions(usernames[0]);
    assert(permissions instanceof Array);
    assert(permissions.length > 0);
    assert(_.has(permissions[0], 'user'));
    assert(_.has(permissions[0], 'vhost'));
  });

  test('queues', async () => {
    await rabbitManager.createQueue(queuenames[0]);

    let queues = await rabbitManager.queues();

    // at least one of these is the created queue
    assert(queues instanceof Array);
    queues = _.filter(queues, {name: queuenames[0]});
    assert.equal(queues.length, 1);
  });

  test('createGetDeleteQueue', async () => {
    await rabbitManager.createQueue(queuenames[0]);

    const queue = await rabbitManager.queue(queuenames[0]);
    assert.equal(queue.name, queuenames[0]);

    await rabbitManager.deleteQueue(queuenames[0]);
  });

  test('deleteQueueNotFoundException', async () => {
    try {
      await rabbitManager.deleteQueue(queuenames[0]);
      assert(false);
    } catch (error) {
      assert.equal(error.statusCode, 404);
    }
  });

  test('messagesFromQueue', async () => {
    await rabbitManager.createQueue(queuenames[0]);
    const channel = await helper.channel();
    await channel.sendToQueue(queuenames[0], Buffer.from('foobar'));

    const dequeuedMessages = await rabbitManager.messagesFromQueue(queuenames[0]);
    assert(dequeuedMessages instanceof Array);
    assert(_.has(dequeuedMessages[0], 'payload_bytes'));
    assert(_.has(dequeuedMessages[0], 'redelivered'));
    assert(_.has(dequeuedMessages[0], 'exchange'));
    assert(_.has(dequeuedMessages[0], 'routing_key'));
    assert(_.has(dequeuedMessages[0], 'message_count'));
    assert(_.has(dequeuedMessages[0], 'properties'));
  });
});
