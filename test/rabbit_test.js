suite('Rabbit Wrapper', () => {
  const assert = require('assert');
  const slugid = require('slugid');
  const _ = require('lodash');
  const helper = require('./helper');

  let usernames = [];
  let queuenames = [];

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
        await helper.rabbit.deleteUser(username);
      } catch (e) {
        // Intentianlly do nothing since this user might not have been created.
      }
    }
    for (let queuename of queuenames) {
      try {
        await helper.rabbit.deleteQuee(queuename);
      } catch (e) {
        // Intentianlly do nothing since this queue might not have been created.
      }
    }
  });

  test('overview', async () => {
    const overview = await helper.rabbit.overview();
    assert(_.has(overview, 'rabbitmq_version'));
    assert(_.has(overview, 'management_version'));
    assert(_.has(overview, 'cluster_name'));
  });

  test('clusterName', async () => {
    const clusterName = await helper.rabbit.clusterName();
    assert(_.has(clusterName, 'name'));
  });

  test('createAndDeleteUser', async () => {
    await helper.rabbit.createUser(usernames[0], 'dummy', []);
    await helper.rabbit.deleteUser(usernames[0]);
  });

  test('deleteUserException', async () => {
    try {
      await helper.rabbit.deleteUser(usernames[0]);
      assert(false);
    } catch (error) {
      assert.equal(error.statusCode, 404);
    }
  });

  test('users', async () => {
    const usersList = await helper.rabbit.users();
    assert(usersList instanceof Array);
    // At least we have the user used for connecting to the management API.
    assert(usersList.length > 0);
    assert(_.has(usersList[0], 'name'));
    assert(_.has(usersList[0], 'tags'));
  });

  test('usersWithAllTags', async () => {
    await helper.rabbit.createUser(usernames[0], 'dummy', ['foo', 'bar']);
    await helper.rabbit.createUser(usernames[1], 'dummy', ['foo']);
    await helper.rabbit.createUser(usernames[2], 'dummy', ['bar']);
    await helper.rabbit.createUser(usernames[3], 'dummy', ['bar', 'foo']);

    const tags = ['foo', 'bar'];
    const usersWithAllTags = await helper.rabbit.usersWithAllTags(tags);

    assert(usersWithAllTags.length === 2);
    assert(_.find(usersWithAllTags, {name: usernames[0]}));
    assert(_.find(usersWithAllTags, {name: usernames[3]}));
  });

  test('usersWithAnyTags', async () => {
    await helper.rabbit.createUser(usernames[0], 'dummy', ['moo', 'tar']);
    await helper.rabbit.createUser(usernames[1], 'dummy', ['moo']);
    await helper.rabbit.createUser(usernames[2], 'dummy', ['tar']);
    await helper.rabbit.createUser(usernames[3], 'dummy', ['tar', 'moo']);
    await helper.rabbit.createUser(usernames[4], 'dummy', ['car', 'moo']);

    const tags = ['tar', 'car'];
    const usersWithAnyTags = await helper.rabbit.usersWithAnyTags(tags);

    assert(usersWithAnyTags.length === 4);
    assert(_.find(usersWithAnyTags, {name: usernames[0]}));
    assert(_.find(usersWithAnyTags, {name: usernames[2]}));
    assert(_.find(usersWithAnyTags, {name: usernames[3]}));
    assert(_.find(usersWithAnyTags, {name: usernames[4]}));
  });

  test('userPermissions_singleVhost', async () => {
    await helper.rabbit.createUser(usernames[0], 'dummy', []);
    await helper.rabbit.setUserPermissions(usernames[0], '/', '.*', '.*', '.*');

    let permissions = await helper.rabbit.userPermissions(usernames[0], '/');
    assert(_.has(permissions, 'user'));
    assert(_.has(permissions, 'vhost'));
    // Delete the permission and test the error case.
    await helper.rabbit.deleteUserPermissions(usernames[0], '/');
    try {
      await helper.rabbit.userPermissions(usernames[0], '/');
      assert(false);
    } catch (error) {
      assert.equal(error.statusCode, 404);
    }
  });

  test('userPermissions_allVhosts', async () => {
    await helper.rabbit.createUser(usernames[0], 'dummy', []);
    await helper.rabbit.setUserPermissions(usernames[0], '/', '.*', '.*', '.*');

    let permissions = await helper.rabbit.userPermissions(usernames[0]);
    assert(permissions instanceof Array);
    assert(permissions.length > 0);
    assert(_.has(permissions[0], 'user'));
    assert(_.has(permissions[0], 'vhost'));
  });

  test('queues', async () => {
    await helper.rabbit.createQueue(queuenames[0]);

    const queues = await helper.rabbit.queues();

    assert(queues instanceof Array);
    assert(queues.length > 0);
    assert(_.has(queues[0], 'memory'));
    assert(_.has(queues[0], 'messages'));
    assert(_.has(queues[0], 'messages_details'));
    assert(_.has(queues[0], 'messages_ready'));
    assert(_.has(queues[0], 'name'));
  });

  test('createGetDeleteQueue', async () => {
    await helper.rabbit.createQueue(queuenames[0]);

    const queue = await helper.rabbit.queue(queuenames[0]);
    assert.equal(queue.name, queuenames[0]);

    await helper.rabbit.deleteQueue(queuenames[0]);
  });

  test('deleteQueueNotFoundException', async () => {
    try {
      await helper.rabbit.deleteQueue(queuenames[0]);
      assert(false);
    } catch (error) {
      assert.equal(error.statusCode, 404);
    }
  });

  test('messagesFromQueue', async () => {
    const messages = ['some', 'messages'];
    const delayBetweenMessages = 0;
    await helper.rabbit.createQueue(queuenames[0]);
    await helper.stressor.sendMessages(queuenames[0], messages, delayBetweenMessages);

    const dequeuedMessages = await helper.rabbit.messagesFromQueue(queuenames[0]);

    assert(dequeuedMessages instanceof Array);
    assert(_.has(dequeuedMessages[0], 'payload_bytes'));
    assert(_.has(dequeuedMessages[0], 'redelivered'));
    assert(_.has(dequeuedMessages[0], 'exchange'));
    assert(_.has(dequeuedMessages[0], 'routing_key'));
    assert(_.has(dequeuedMessages[0], 'message_count'));
    assert(_.has(dequeuedMessages[0], 'properties'));
  });
});
